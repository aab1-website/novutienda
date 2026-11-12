// «Cambios sin publicar» de la consola: una sola vía (la consola ya no crea ni edita productos: todo cambio nace en Inventarios), el evento `producto.cambiado` que publica Inventarios en la misma
// transacción y consume el coordinador (`consola:producto.cambiado`). Cada cambio cuenta exactamente una vez.
import { actualizarProducto, crearProducto, importarProductosCsv } from '@novutienda/inventarios';
import { beforeEach, describe, expect, it } from 'vitest';
import { ADM, T, doc, entornoListo, eventosDe, op, producto, type Entorno } from './entorno.js';

let e: Entorno;

const cambios = (): number => (doc(e, T, 'sitio/estado')?.['cambios'] as number | undefined) ?? 0;
/** Entrega todo lo publicado y devuelve cuánto subió el contador. */
const entregar = async (opciones: { duplicados?: number } = {}): Promise<number> => {
  const antes = cambios();
  const r = await e.bandeja.entregar(T, opciones);
  expect(r.fallidas).toEqual([]);
  return cambios() - antes;
};

beforeEach(async () => {
  e = await entornoListo();
  await entregar(); // asienta lo del sembrado (2 altas)
});

describe('consola:producto.cambiado cuenta cada cambio de producto una vez', () => {
  it('el sembrado cuenta una vez por producto', () => {
    expect(cambios()).toBe(2);
  });

  it('crear, editar y cambiar precio por inventarios.* suman 1 cada uno', async () => {
    await e.db.runTransaction((tx) => crearProducto(tx, { tenantId: T, operacionId: op(), por: ADM, producto: producto('taladro') }));
    expect(await entregar()).toBe(1);
    await e.db.runTransaction((tx) => actualizarProducto(tx, { tenantId: T, operacionId: op(), por: ADM, productoId: 'taladro', cambios: { nombre: 'Taladro 2' } }));
    expect(await entregar()).toBe(1);
    await e.db.runTransaction((tx) => actualizarProducto(tx, { tenantId: T, operacionId: op(), por: ADM, productoId: 'taladro', cambios: { precioUSD: { bo: 2000, ar: 2000 } } }));
    expect(await entregar()).toBe(1);
  });

  it('la importación CSV de Inventarios de N productos suma N (un evento por producto)', async () => {
    const csv = ['id,nombre,categoria,sku,precioUSDbo,precioUSDar', ...[1, 2, 3].map((n) => `imp-${String(n)},Imp ${String(n)},general,SKU-IMP-${String(n)},10,10`)].join('\n');
    await e.db.runTransaction((tx) => importarProductosCsv(tx, { tenantId: T, operacionId: op(), por: ADM, csv }));
    expect(eventosDe(e, T, 'producto.cambiado')).toHaveLength(5);
    expect(await entregar()).toBe(3);
  });

  it('la importación de Inventarios que actualiza datos y precio de un producto existente y crea otro suma un cambio por producto', async () => {
    const csv = 'id,nombre,categoria,sku,precioUSDbo,precioUSDar\nlapiz,Lápiz 2,general,SKU-lapiz,15,15\nnuevo,Nuevo,general,SKU-nuevo,5,5\n';
    await e.db.runTransaction((tx) => importarProductosCsv(tx, { tenantId: T, operacionId: op(), por: ADM, csv }));
    expect(await entregar()).toBe(2); // lapiz: un evento con datos y precio juntos; nuevo: alta
  });

  it('la reentrega (duplicada) del mismo evento no vuelve a contar', async () => {
    await e.db.runTransaction((tx) => crearProducto(tx, { tenantId: T, operacionId: op(), por: ADM, producto: producto('martillo') }));
    expect(await entregar({ duplicados: 3 })).toBe(1);
    expect(await entregar({ duplicados: 2 })).toBe(0);
  });

  it('repetir la misma operación (mismo operacionId) no publica ni cuenta otro cambio', async () => {
    const operacionId = op();
    const alta = () => e.db.runTransaction((tx) => crearProducto(tx, { tenantId: T, operacionId, por: ADM, producto: producto('pala') }));
    await alta();
    await alta();
    expect(await entregar()).toBe(1);
  });

  it('con la consola apagada el consumidor no hace nada ni falla, y el evento queda tratado', async () => {
    const t = e.db.dato(`tenants/${T}`) as { modulos: Record<string, unknown> };
    const { consola: _c, ...sin } = t.modulos;
    void _c;
    e.db.poner(`tenants/${T}`, { ...t, modulos: sin });
    await e.db.runTransaction((tx) => crearProducto(tx, { tenantId: T, operacionId: op(), por: ADM, producto: producto('taladro') }));
    expect(await entregar()).toBe(0);
    expect(doc(e, T, 'sitio/estado')).toMatchObject({ cambios: 2 });
  });
});
