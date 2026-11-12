import { describe, expect, it } from 'vitest';
import { AHORA, crearEntorno, uuid, type Entorno } from '../ayuda-pruebas.js';
import { ErrorApi, mensajeDeError } from '../api/errores.js';
import type { UbicacionId } from '../api/tipos.js';

/** Abre un conteo como `sup` y deja al entorno en el rol pedido. */
async function conConteo(rol: 'caj' | 'sup' | 'adm', ubicaciones: UbicacionId[] = ['tienda']): Promise<Entorno> {
  const e = crearEntorno('sup');
  for (const u of ubicaciones) await e.api.llamar('abrirConteo', { operacionId: uuid(), conteoId: `conteo-${u}`, ubicacionId: u });
  e.como(rol);
  return e;
}
async function falla(p: Promise<unknown>): Promise<ErrorApi> {
  try {
    await p;
  } catch (x) {
    return x as ErrorApi;
  }
  throw new Error('Debía fallar');
}
const producto = async (e: Entorno, id: string) => (await e.api.llamar('listarProductos', {})).find((p) => p.id === id);

describe('doble: existencias ocultas durante un conteo abierto', () => {
  it('sin conteo abierto nadie recibe marca y todo es numérico', async () => {
    const e = crearEntorno('caj');
    const l = await e.api.llamar('listarProductos', {});
    expect(l.existenciasOcultas).toBeUndefined();
    expect(l.conteosAbiertos).toBeUndefined();
    expect(l.find((p) => p.id === 'cable-hdmi')).toMatchObject({ stockTotal: 35, bajoMinimo: false, disponible: true });
  });

  it.each(['caj', 'sup'] as const)('%s: con la tienda en conteo no recibe total, bajo mínimo ni disponible, y la tienda va null (nunca 0)', async (rol) => {
    const e = await conConteo(rol);
    const l = await e.api.llamar('listarProductos', {});
    expect(l.existenciasOcultas).toBe(true);
    expect(l.conteosAbiertos).toEqual([{ ubicacionId: 'tienda', conteoId: 'conteo-tienda', abiertoEn: new Date(AHORA).toISOString() }]);
    const p = l.find((x) => x.id === 'cable-hdmi');
    expect(p).toMatchObject({ stockTotal: null, bajoMinimo: null, disponible: null });
    expect(p?.existencias).toEqual({ tienda: null, 'deposito-1': 10, 'deposito-2': 0 });
    // Un producto sin existencias en la tienda también va null: no se revela cuál tiene documento.
    expect((await producto(e, 'audifonos'))?.existencias.tienda).toBeNull();
  });

  it('adm ve todo, sin marca', async () => {
    const e = await conConteo('adm');
    const l = await e.api.llamar('listarProductos', {});
    expect(l.existenciasOcultas).toBeUndefined();
    expect(l.find((p) => p.id === 'cable-hdmi')).toMatchObject({ stockTotal: 35, disponible: true, existencias: { tienda: 25, 'deposito-1': 10, 'deposito-2': 0 } });
  });

  it('con un depósito en conteo: total y bajo mínimo se ocultan, la tienda y «disponible» se ven', async () => {
    const e = await conConteo('caj', ['deposito-1']);
    const p = await producto(e, 'cable-hdmi');
    expect(p).toMatchObject({ stockTotal: null, bajoMinimo: null, disponible: true });
    expect(p?.existencias).toEqual({ tienda: 25, 'deposito-1': null, 'deposito-2': 0 });
  });

  it('varios conteos abiertos: una marca con cada uno, y el cierre de uno solo lo restituye', async () => {
    const e = await conConteo('sup', ['tienda', 'deposito-1']);
    expect((await e.api.llamar('listarProductos', {})).conteosAbiertos?.map((c) => c.ubicacionId)).toEqual(['deposito-1', 'tienda']);
    await e.api.llamar('cerrarConteo', { operacionId: uuid(), conteoId: 'conteo-tienda' });
    const l = await e.api.llamar('listarProductos', {});
    expect(l.conteosAbiertos?.map((c) => c.ubicacionId)).toEqual(['deposito-1']);
    expect((await producto(e, 'cable-hdmi'))?.existencias.tienda).toBe(25);
    await e.api.llamar('cerrarConteo', { operacionId: uuid(), conteoId: 'conteo-deposito-1' });
    const fin = await e.api.llamar('listarProductos', {});
    expect(fin.existenciasOcultas).toBeUndefined();
    expect(fin.find((p) => p.id === 'cable-hdmi')).toMatchObject({ stockTotal: 35, bajoMinimo: false, disponible: true });
  });

  it('un producto que no controla stock sigue sin `stockTotal` (no se confunde con oculto)', async () => {
    const e = await conConteo('sup');
    e.como('adm');
    await e.api.llamar('crearProducto', { operacionId: uuid(), producto: { id: 'servicio-1', nombre: 'Servicio', categoria: 'Servicios', sku: 'SRV', precioUSD: { bo: 100, ar: 100 }, controlaStock: false } });
    e.como('caj');
    const p = await producto(e, 'servicio-1');
    expect(p?.stockTotal).toBeUndefined();
    expect(p?.disponible).toBe(true);
  });

  it('series: se quitan las disponibles del almacén en conteo, no las de otro', async () => {
    const e = await conConteo('caj');
    const s = await e.api.llamar('listarSeries', { productoId: 'tv-55', soloDisponibles: true });
    expect(s.map((x) => x.serie)).toEqual(['TV55-004', 'TV55-005']);
    expect(s.existenciasOcultas).toBe(true);
    e.como('adm');
    expect((await e.api.llamar('listarSeries', { productoId: 'tv-55', soloDisponibles: true })).length).toBe(5);
  });

  it('movimientos: sin saldo del almacén en conteo, con saldo en los demás, y marca', async () => {
    const e = crearEntorno('adm');
    await e.api.llamar('ajustar', { operacionId: uuid(), motivo: 'prueba', lineas: [{ productoId: 'cable-hdmi', ubicacionId: 'tienda', delta: 1 }, { productoId: 'cable-hdmi', ubicacionId: 'deposito-1', delta: 1 }] });
    e.como('sup');
    await e.api.llamar('abrirConteo', { operacionId: uuid(), conteoId: 'c1', ubicacionId: 'tienda' });
    const m = await e.api.llamar('listarMovimientos', {});
    expect(m.existenciasOcultas).toBe(true);
    expect(m.movimientos.find((x) => x.ubicacionId === 'tienda')?.saldoUbicacion).toBeUndefined();
    expect(m.movimientos.find((x) => x.ubicacionId === 'deposito-1')?.saldoUbicacion).toBe(11);
    e.como('adm');
    expect((await e.api.llamar('listarMovimientos', {})).movimientos.find((x) => x.ubicacionId === 'tienda')?.saldoUbicacion).toBe(26);
  });

  it('el filtro «bajo el mínimo» se rechaza con `existencias-ocultas`, y para adm sigue funcionando', async () => {
    const e = await conConteo('sup');
    const err = await falla(e.api.transporte.invocar('inventarios', { accion: 'listarProductos', tenantId: 'demo', datos: { soloBajoMinimo: true } }));
    expect(err.codigoHttps).toBe('failed-precondition');
    expect(err.detalle.codigo).toBe('existencias-ocultas');
    expect(mensajeDeError(err)).toBe('Este filtro no está disponible mientras hay un conteo abierto.');
    e.como('adm');
    await expect(e.api.transporte.invocar('inventarios', { accion: 'listarProductos', tenantId: 'demo', datos: { soloBajoMinimo: true } })).resolves.toBeTruthy();
  });

  it('stock insuficiente al traspasar: sin «hay Y» para sup en el almacén en conteo; con «hay Y» para adm y en otros almacenes', async () => {
    const e = await conConteo('sup', ['deposito-1']);
    const pide = (origenId: UbicacionId) => e.api.llamar('traspasar', { operacionId: uuid(), origenId, destinoId: 'tienda', lineas: [{ productoId: 'cable-hdmi', cantidad: 999 }] });
    const oculto = await falla(pide('deposito-1'));
    expect(oculto.detalle.faltantes?.[0]?.disponible).toBeUndefined();
    expect(mensajeDeError(oculto)).toBe('No alcanza el stock de cable-hdmi en deposito-1.');
    expect(mensajeDeError(await falla(pide('deposito-2')))).toContain('pidió 999, hay 0');
    e.como('adm');
    expect(mensajeDeError(await falla(pide('deposito-1')))).toContain('pidió 999, hay 10');
  });

  it('stock insuficiente al vender: la cajera no recibe cuántas hay de la tienda en conteo', async () => {
    const e = await conConteo('caj');
    await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 10000 } });
    const err = await falla(e.api.llamar('confirmarVenta', {
      requestId: uuid(), carrito: { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'parlante', cantidad: 5 }] }, pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 87000 }],
    }));
    expect(err.detalle.codigo).toBe('stock-insuficiente');
    expect(err.detalle.faltantes?.[0]?.disponible).toBeUndefined();
    expect(mensajeDeError(err)).toContain('No alcanza el stock de parlante en tienda.');
    expect(mensajeDeError(err)).not.toContain('hay ');
  });
});
