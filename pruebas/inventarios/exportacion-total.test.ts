// Descarga total (hojas del libro): orden de las hojas, columnas de Productos, números de verdad, textos en español, fechas de La Paz,
// recortes y margen con conversión y sus notas.
import { describe, expect, it } from 'vitest';
import {
  armarExportacionTotal, columnasDeExportacion, fechaHoraEn, HOJAS_EXPORTACION_TOTAL, MAX_MOVIMIENTOS_EXPORTACION, MAX_SERIES_EXPORTACION,
  type EntradaExportacionTotal, type ProductoExportable,
} from './api.js';
import { COMERCIAL_TRES, COMERCIAL_UN_MERCADO } from './entorno.js';

const prod = (id: string, extra: Partial<ProductoExportable> = {}): ProductoExportable => ({
  id, nombre: `Producto ${id}`, categoria: 'general', sku: `SKU-${id}`, conSerie: false, precioUSD: { bo: 10_000, ar: 11_000 }, activo: true, publicado: false, ...extra,
});
const entrada = (extra: Partial<EntradaExportacionTotal> = {}): EntradaExportacionTotal => ({
  productos: [prod('uno', { costoUSD: 5_000 })], comercial: COMERCIAL_TRES,
  almacenes: [{ id: 'tienda', nombre: 'Tienda' }], existencias: [], unidades: [], movimientos: [], cotizaciones: {}, ...extra,
});
const hojasDe = (e: EntradaExportacionTotal) => armarExportacionTotal(e).hojas;

describe('armarExportacionTotal', () => {
  it('trae las cinco hojas en orden y Productos con las columnas de la exportación y los importes como números', () => {
    const hojas = hojasDe(entrada());
    expect(hojas.map((h) => h.nombre)).toEqual([...HOJAS_EXPORTACION_TOTAL]);
    expect(hojas[0]?.filas[0]).toEqual([...columnasDeExportacion(COMERCIAL_TRES)]);
    expect(hojas[0]?.filas[1]).toEqual(['Producto uno', 'general', '', 'SKU-uno', 'no', '', '', 100, 110, 50, 'sí', 'no']);
  });

  it('existencias, series y movimientos usan nombres, etiquetas en español, referencia legible y hora de La Paz', () => {
    const hojas = hojasDe(entrada({
      existencias: [{ productoId: 'uno', ubicacionId: 'tienda', cantidad: 4 }],
      unidades: [{ productoId: 'uno', serie: 'S-1', estado: 'vendida', ubicacionId: 'tienda', garantiaHasta: '2027-01-31' }],
      movimientos: [{ fecha: '2026-11-01T14:05:00.000Z', tipo: 'anulacion', productoId: 'uno', ubicacionId: 'tienda', delta: -1, referencia: 'venta:v-interno-1' }],
    }));
    expect(hojas[1]?.filas[1]).toEqual(['Producto uno', 'SKU-uno', 'Tienda', 4]);
    expect(hojas[2]?.filas[1]).toEqual(['Producto uno', 'S-1', 'Vendida', 'Tienda', '2027-01-31']);
    expect(hojas[3]?.filas[1]).toEqual(['2026-11-01 10:05', 'Anulación de venta', 'Producto uno', 'Tienda', -1, 'Venta']);
  });

  it('fechaHoraEn da AAAA-MM-DD HH:MM en la zona pedida y vacío si no es fecha', () => {
    expect(fechaHoraEn('2026-11-02T03:30:00.000Z', 'America/La_Paz')).toBe('2026-11-01 23:30');
    expect(fechaHoraEn('no es fecha', 'America/La_Paz')).toBe('');
  });

  it('marca el recorte solo cuando hay MÁS que el tope y escribe hasta el tope', () => {
    const mov = (i: number) => ({ fecha: '2026-11-01T14:05:00.000Z', tipo: 'venta', productoId: 'uno', ubicacionId: 'tienda', delta: -1, referencia: `venta:${String(i)}` });
    const uni = (i: number) => ({ productoId: 'uno', serie: `S-${String(i).padStart(6, '0')}`, estado: 'disponible', ubicacionId: 'tienda' });
    const justo = armarExportacionTotal(entrada({
      movimientos: Array.from({ length: MAX_MOVIMIENTOS_EXPORTACION }, (_, i) => mov(i)), unidades: Array.from({ length: MAX_SERIES_EXPORTACION }, (_, i) => uni(i)),
    }));
    expect(justo.recortado).toBe(false);
    expect(justo.seriesRecortadas).toBe(false);
    const pasado = armarExportacionTotal(entrada({
      movimientos: Array.from({ length: MAX_MOVIMIENTOS_EXPORTACION + 1 }, (_, i) => mov(i)), unidades: Array.from({ length: MAX_SERIES_EXPORTACION + 1 }, (_, i) => uni(i)),
    }));
    expect(pasado.recortado).toBe(true);
    expect(pasado.seriesRecortadas).toBe(true);
    expect(pasado.hojas[3]?.filas).toHaveLength(MAX_MOVIMIENTOS_EXPORTACION + 1);
    expect(pasado.hojas[2]?.filas).toHaveLength(MAX_SERIES_EXPORTACION + 1);
  });

  it('el margen convierte el costo en la moneda base con el tipo de cambio del día y anota su valor y fecha', () => {
    const cotizaciones = { BO: { par: 'BOB/USD', valor: 7, fecha: '2026-11-22' }, AR: { par: 'ARS/USD', valor: 1000, fecha: '2026-11-22' } };
    const m = hojasDe(entrada({ cotizaciones }))[4]!.filas;
    // BO: precio 100 USD * 7 = 700 BOB; costo 50 USD * 7 = 350 BOB; margen 50 %.
    expect(m[1]).toEqual(['Producto uno', 'SKU-uno', 'Bolivia', 'BOB', 700, 'USD', 50, 350, 50, 7, '2026-11-22', '']);
    // AR: precio 110 USD * 1000 = 110000 (múltiplo de 100); costo 50.000; margen 54,5 %.
    expect(m[2]).toEqual(['Producto uno', 'SKU-uno', 'Argentina', 'ARS', 110000, 'USD', 50, 50000, 54.5, 1000, '2026-11-22', '']);
  });

  it('sin tipo de cambio vigente, sin costo o con costo en otra moneda la fila queda sin margen y con su nota', () => {
    const sinCot = hojasDe(entrada())[4]!.filas;
    expect(sinCot[1]?.[11]).toBe('Sin tipo de cambio vigente');
    expect(sinCot[1]?.[8]).toBe('');
    const sinCosto = hojasDe(entrada({ productos: [prod('dos')], cotizaciones: { BO: { par: 'BOB/USD', valor: 7, fecha: '2026-11-22' } } }))[4]!.filas;
    expect(sinCosto[1]?.[11]).toBe('Sin costo');
    const otra = hojasDe(entrada({
      comercial: { ...COMERCIAL_TRES, monedaCosto: 'EUR' }, cotizaciones: { BO: { par: 'BOB/USD', valor: 7, fecha: '2026-11-22' } },
    }))[4]!.filas;
    expect(otra[1]?.[11]).toBe('El costo está en EUR y no se puede llevar a BOB');
  });

  it('un precio en cero queda «Sin precio»', () => {
    const m = hojasDe(entrada({ productos: [prod('cero', { precioUSD: { bo: 0, ar: 0 } })] }))[4]!.filas;
    expect(m[1]?.[11]).toBe('Sin precio');
  });

  it('un mercado sin tipo de cambio y con el costo en su moneda no convierte', () => {
    const m = hojasDe(entrada({ comercial: { ...COMERCIAL_UN_MERCADO, monedaCosto: 'PEN' }, productos: [prod('uno', { precioUSD: { pe: 20_000 }, costoUSD: 15_000 })] }))[4]!.filas;
    expect(m[1]).toEqual(['Producto uno', 'SKU-uno', 'Perú', 'PEN', 200, 'PEN', 150, 150, 25, '', '', '']);
  });
});
