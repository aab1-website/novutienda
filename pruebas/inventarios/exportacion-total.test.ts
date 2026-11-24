// Descarga total (hojas del libro): orden de las hojas, columnas de Productos, margen con conversión y sus notas.
import { describe, expect, it } from 'vitest';
import { armarExportacionTotal, columnasDeExportacion, HOJAS_EXPORTACION_TOTAL, type EntradaExportacionTotal, type ProductoExportable } from './api.js';
import { COMERCIAL_TRES, COMERCIAL_UN_MERCADO } from './entorno.js';

const prod = (id: string, extra: Partial<ProductoExportable> = {}): ProductoExportable => ({
  id, nombre: `Producto ${id}`, categoria: 'general', sku: `SKU-${id}`, conSerie: false, precioUSD: { bo: 10_000, ar: 11_000 }, activo: true, publicado: false, ...extra,
});
const entrada = (extra: Partial<EntradaExportacionTotal> = {}): EntradaExportacionTotal => ({
  productos: [prod('uno', { costoUSD: 5_000 })], comercial: COMERCIAL_TRES,
  almacenes: [{ id: 'tienda', nombre: 'Tienda' }], existencias: [], unidades: [], movimientos: [], cotizaciones: {}, ...extra,
});

describe('armarExportacionTotal', () => {
  it('trae las cinco hojas en orden y Productos con las columnas de la exportación', () => {
    const hojas = armarExportacionTotal(entrada());
    expect(hojas.map((h) => h.nombre)).toEqual([...HOJAS_EXPORTACION_TOTAL]);
    expect(hojas[0]?.filas[0]).toEqual([...columnasDeExportacion(COMERCIAL_TRES)]);
    expect(hojas[0]?.filas[1]).toEqual(['Producto uno', 'general', '', 'SKU-uno', 'no', '', '', '100.00', '110.00', '50.00', 'sí', 'no']);
  });

  it('existencias, series y movimientos usan nombres de producto y de almacén', () => {
    const hojas = armarExportacionTotal(entrada({
      existencias: [{ productoId: 'uno', ubicacionId: 'tienda', cantidad: 4 }],
      unidades: [{ productoId: 'uno', serie: 'S-1', estado: 'disponible', ubicacionId: 'tienda', garantiaHasta: '2027-01-31' }],
      movimientos: [{ fecha: '2026-11-01T10:00:00.000Z', tipo: 'venta', productoId: 'uno', ubicacionId: 'tienda', delta: -1, referencia: 'venta:v1' }],
    }));
    expect(hojas[1]?.filas[1]).toEqual(['Producto uno', 'SKU-uno', 'Tienda', 4]);
    expect(hojas[2]?.filas[1]).toEqual(['Producto uno', 'S-1', 'disponible', 'Tienda', '2027-01-31']);
    expect(hojas[3]?.filas[1]).toEqual(['2026-11-01T10:00:00.000Z', 'venta', 'Producto uno', 'Tienda', -1, 'venta:v1']);
  });

  it('el margen convierte el costo en la moneda base con el tipo de cambio del día y anota su valor y fecha', () => {
    const cotizaciones = { BO: { par: 'BOB/USD', valor: 7, fecha: '2026-11-22' }, AR: { par: 'ARS/USD', valor: 1000, fecha: '2026-11-22' } };
    const m = armarExportacionTotal(entrada({ cotizaciones }))[4]!.filas;
    // BO: precio 100 USD * 7 = 700,00 BOB; costo 50 USD * 7 = 350,00 BOB; margen 50 %.
    expect(m[1]).toEqual(['Producto uno', 'SKU-uno', 'Bolivia', 'BOB', '700.00', 'USD', '50.00', '350.00', 50, '7', '2026-11-22', '']);
    // AR: precio 110 USD * 1000 = 110000 (múltiplo de 100); costo 50.000,00; margen 54,5 %.
    expect(m[2]).toEqual(['Producto uno', 'SKU-uno', 'Argentina', 'ARS', '110000.00', 'USD', '50.00', '50000.00', 54.5, '1000', '2026-11-22', '']);
  });

  it('sin tipo de cambio vigente, sin costo o con costo en otra moneda la fila queda sin margen y con su nota', () => {
    const sinCot = armarExportacionTotal(entrada())[4]!.filas;
    expect(sinCot[1]?.[11]).toBe('Sin tipo de cambio vigente');
    expect(sinCot[1]?.[8]).toBe('');
    const sinCosto = armarExportacionTotal(entrada({ productos: [prod('dos')], cotizaciones: { BO: { par: 'BOB/USD', valor: 7, fecha: '2026-11-22' } } }))[4]!.filas;
    expect(sinCosto[1]?.[11]).toBe('Sin costo');
    const otra = armarExportacionTotal(entrada({
      comercial: { ...COMERCIAL_TRES, monedaCosto: 'EUR' }, cotizaciones: { BO: { par: 'BOB/USD', valor: 7, fecha: '2026-11-22' } },
    }))[4]!.filas;
    expect(otra[1]?.[11]).toBe('El costo está en EUR y no se puede llevar a BOB');
  });

  it('un mercado sin tipo de cambio y con el costo en su moneda no convierte', () => {
    const m = armarExportacionTotal(entrada({ comercial: { ...COMERCIAL_UN_MERCADO, monedaCosto: 'PEN' }, productos: [prod('uno', { precioUSD: { pe: 20_000 }, costoUSD: 15_000 })] }))[4]!.filas;
    expect(m[1]).toEqual(['Producto uno', 'SKU-uno', 'Perú', 'PEN', '200.00', 'PEN', '150.00', '150.00', 25, '', '', '']);
  });
});
