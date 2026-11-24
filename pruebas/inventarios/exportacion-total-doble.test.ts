// Paridad: las hojas del doble del panel (versión compacta) y `armarExportacionTotal` con la MISMA entrada, incluidos «Sin costo»,
// «Sin precio», el tipo de cambio ausente y los recortes de movimientos y de series.
import { describe, expect, it } from 'vitest';
import type { ConfiguracionComercial } from '@novutienda/nucleo';
import { armarExportacionTotal, MAX_MOVIMIENTOS_EXPORTACION, MAX_SERIES_EXPORTACION } from './api.js';

// El doble vive en el panel (carpeta `src/`): la prueba lo carga por ruta, sin importación profunda estática.
const RUTA_DOBLE = '../../paquetes/panel/src/doble/inventario/exportacion-total.ts';
const RUTA_ESTADO = '../../paquetes/panel/src/doble/estado.ts';
type Doble = typeof import('../../paquetes/panel/src/doble/inventario/exportacion-total.js');
type Estado = typeof import('../../paquetes/panel/src/doble/estado.js');
const { exportarTotalDoble } = (await import(/* @vite-ignore */ RUTA_DOBLE)) as Doble;
const { crearEstado } = (await import(/* @vite-ignore */ RUTA_ESTADO)) as Estado;

const AHORA = Date.parse('2026-11-23T15:00:00.000Z');
const ALMACENES = [{ id: 'tienda', nombre: 'Tienda' }, { id: 'deposito-1', nombre: 'Depósito 1' }, { id: 'deposito-2', nombre: 'Depósito 2' }];

function escenario(opciones: { movimientos?: number; series?: number; sinCotizacionAR?: boolean } = {}) {
  const e = crearEstado(AHORA);
  const base = [...e.productos.values()][0]!;
  e.productos.clear();
  const mk = (id: string, extra: Record<string, unknown>) => e.productos.set(id, { ...base, id, nombre: `Producto ${id}`, sku: `SKU-${id}`, ...extra } as never);
  mk('a', { precioUSD: { bo: 10_000, ar: 11_000 }, costoUSD: 5_000, conSerie: true, minimo: 2, garantiaMeses: 12 });
  mk('b', { precioUSD: { bo: 10_000, ar: 11_000 }, costoUSD: undefined });
  mk('c', { precioUSD: { bo: 0, ar: 0 }, costoUSD: 100 });
  mk('d', { precioUSD: { bo: 2_550 }, costoUSD: 1_999, marca: 'Marca' });
  e.unidades.clear();
  for (let i = 0; i < (opciones.series ?? 3); i++) e.unidades.set(`a${String(i)}`, { productoId: 'a', serie: `S-${String(i).padStart(6, '0')}`, estado: i % 2 === 0 ? 'disponible' : 'vendida', ubicacionId: 'tienda', ...(i === 0 ? { garantiaHasta: '2027-11-01' } : {}) } as never);
  e.movimientos.length = 0;
  for (let i = 0; i < (opciones.movimientos ?? 3); i++) {
    e.movimientos.push({ id: `m${String(i)}`, operacionId: `o${String(i)}`, productoId: 'a', ubicacionId: 'tienda', tipo: i % 2 === 0 ? 'venta' : 'merma', delta: i % 2 === 0 ? -1 : 2, series: [], por: 'u', rol: 'adm', fecha: new Date(AHORA - i * 60_000).toISOString(), ...(i % 2 === 0 ? { referencia: `venta:v${String(i)}` } : {}) } as never);
  }
  if (opciones.sinCotizacionAR === true) (e.cotizaciones as Record<string, unknown>)['AR'] = null;
  return e;
}

function real(e: ReturnType<typeof escenario>) {
  const comercial: ConfiguracionComercial = {
    mercados: e.comercial.mercados.map((m) => ({
      id: m.id, nombre: m.nombre, monedaVenta: m.monedaVenta, monedaBase: m.monedaBase, zonaHoraria: 'America/La_Paz',
      tipoCambio: m.tieneTipoCambio ? { par: `${m.monedaVenta}/${m.monedaBase}`, fuentes: ['manual'] } : null,
      redondeo: e.redondeo[m.monedaVenta] ?? { tipo: 'decimales', decimales: 2, modo: 'cercano' },
    })),
    monedas: [...e.comercial.monedasCaja], ...(e.comercial.monedaCosto !== undefined ? { monedaCosto: e.comercial.monedaCosto } : {}),
  };
  const cotizaciones = Object.fromEntries(Object.entries(e.cotizaciones).flatMap(([id, k]) => (k === null ? [] : [[id, { par: k.par, valor: k.valor, fecha: k.fecha }]])));
  const productos = [...e.productos.values()].sort((x, y) => x.nombre.localeCompare(y.nombre, 'es')).map((p) => ({
    id: p.id, nombre: p.nombre, categoria: p.categoria, ...(p.marca !== undefined ? { marca: p.marca } : {}), sku: p.sku, conSerie: p.conSerie,
    ...(p.garantiaMeses !== undefined ? { garantiaMeses: p.garantiaMeses } : {}), ...(p.minimo !== undefined ? { minimo: p.minimo } : {}),
    precioUSD: p.precioUSD, ...(typeof p.costoUSD === 'number' ? { costoUSD: p.costoUSD } : {}), activo: p.activo, publicado: p.publicado,
  }));
  return armarExportacionTotal({
    productos, comercial, cotizaciones, almacenes: ALMACENES,
    existencias: [...e.productos.values()].flatMap((p) => (Object.entries(p.existencias) as [string, number][]).map(([ubicacionId, cantidad]) => ({ productoId: p.id, ubicacionId, cantidad }))),
    unidades: [...e.unidades.values()].map((u) => ({ productoId: u.productoId, serie: u.serie, estado: u.estado, ubicacionId: u.ubicacionId, ...(u.garantiaHasta !== undefined ? { garantiaHasta: u.garantiaHasta } : {}) })),
    movimientos: [...e.movimientos].sort((x, y) => y.fecha.localeCompare(x.fecha)).map((m) => ({ fecha: m.fecha, tipo: m.tipo, productoId: m.productoId, ubicacionId: m.ubicacionId, delta: m.delta, ...(m.referencia !== undefined ? { referencia: m.referencia } : {}) })),
  });
}

const doble = (e: ReturnType<typeof escenario>) => exportarTotalDoble({ e, uid: 'u-adm', rol: 'adm', ahora: AHORA, tenantId: 'demo' });

describe('el doble del panel y armarExportacionTotal dan las mismas hojas', () => {
  it('con «Sin costo», «Sin precio», un producto sin precio en un mercado y todo con tipo de cambio', () => {
    const e = escenario();
    expect(doble(e)).toEqual(real(e));
    const notas = real(e).hojas[4]!.filas.map((f) => f[11]);
    expect(notas).toEqual(expect.arrayContaining(['Sin costo', 'Sin precio']));
  });

  it('sin tipo de cambio de un mercado', () => {
    const e = escenario({ sinCotizacionAR: true });
    expect(doble(e)).toEqual(real(e));
    expect(real(e).hojas[4]!.filas.map((f) => f[11])).toContain('Sin tipo de cambio vigente');
  });

  it('con más movimientos y más series que el tope (recortes con >)', () => {
    const e = escenario({ movimientos: MAX_MOVIMIENTOS_EXPORTACION + 1, series: MAX_SERIES_EXPORTACION + 1 });
    const d = doble(e);
    const r = real(e);
    expect(d.recortado).toBe(true);
    expect(d.seriesRecortadas).toBe(true);
    expect(d).toEqual(r);
  });

  it('justo en el tope no marca recorte', () => {
    const e = escenario({ movimientos: MAX_MOVIMIENTOS_EXPORTACION, series: MAX_SERIES_EXPORTACION });
    const d = doble(e);
    expect(d.recortado).toBe(false);
    expect(d.seriesRecortadas).toBe(false);
    expect(d).toEqual(real(e));
  });
});
