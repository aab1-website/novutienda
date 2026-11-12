import { beforeEach, describe, expect, it } from 'vitest';
import { actualizarProducto, crearProducto, EntradaInvalida, importarProductosCsv } from './api.js';
import type { DobleDb } from './doble-db.js';
import { ADM, doc, nuevoEntorno, op, producto, SUP, T } from './entorno.js';

let db: DobleDb;
beforeEach(async () => {
  db = await nuevoEntorno();
});

const eventos = () => db.coleccion(`tenants/${T}/eventos`).filter((e) => e.datos['tipo'] === 'producto.cambiado');
const crear = (id: string, operacionId: string) =>
  db.runTransaction((tx) => crearProducto(tx, { tenantId: T, operacionId, por: ADM, producto: producto(id) }));
const editar = (operacionId: string, cambios: Parameters<typeof actualizarProducto>[1]['cambios']) =>
  db.runTransaction((tx) => actualizarProducto(tx, { tenantId: T, operacionId, por: ADM, productoId: 'lapiz', cambios }));

describe('evento producto.cambiado', () => {
  it('crear publica un evento "creado" con id determinista', async () => {
    await crear('lapiz', 'alta-1');
    expect(eventos()).toHaveLength(1);
    expect(doc(db, 'eventos', 'pc-alta-1')).toMatchObject({ tipo: 'producto.cambiado', version: 1, datos: { productoId: 'lapiz', cambio: 'creado' } });
  });
  it('repetir la operación no publica dos veces', async () => {
    await crear('lapiz', 'alta-1');
    expect((await crear('lapiz', 'alta-1')).repetida).toBe(true);
    expect(eventos()).toHaveLength(1);
  });
  it('editar publica "editado"; precio y otros campos juntos, uno solo', async () => {
    await crear('lapiz', 'alta-1');
    await editar('ed-1', { nombre: 'Otro', precioUSD: { bo: 5, ar: 6 } });
    expect(eventos()).toHaveLength(2);
    expect(doc(db, 'eventos', 'pc-ed-1')).toMatchObject({ datos: { productoId: 'lapiz', cambio: 'editado' } });
    await editar('ed-1', { nombre: 'Otro', precioUSD: { bo: 5, ar: 6 } });
    expect(eventos()).toHaveLength(2);
  });
  it('solo precio publica "precio"', async () => {
    await crear('lapiz', 'alta-1');
    await editar('pr-1', { precioUSD: { bo: 7, ar: 8 } });
    expect(doc(db, 'eventos', 'pc-pr-1')).toMatchObject({ datos: { cambio: 'precio' } });
  });
  it('no publica si la operación falla', async () => {
    await expect(db.runTransaction((tx) => crearProducto(tx, { tenantId: T, operacionId: 'x-1', por: SUP, producto: producto('lapiz') }))).rejects.toThrow();
    await expect(editar('x-2', { nombre: 'a' })).rejects.toThrow();
    await crear('lapiz', 'alta-1');
    await expect(editar('x-3', { garantiaMeses: 0 })).rejects.toBeInstanceOf(EntradaInvalida);
    expect(eventos()).toHaveLength(1);
  });
  it('la importación CSV publica "creado" por producto', async () => {
    const csv = 'id,nombre,categoria,sku,precioUSDbo,precioUSDar\nca,A,c,SKU-A,1,1\ncb,B,c,SKU-B,1,1';
    await db.runTransaction((tx) => importarProductosCsv(tx, { tenantId: T, operacionId: op('csv'), por: ADM, csv }));
    expect(eventos().map((e) => (e.datos['datos'] as Record<string, unknown>)['productoId']).sort()).toEqual(['ca', 'cb']);
    expect(eventos().every((e) => (e.datos['datos'] as Record<string, unknown>)['cambio'] === 'creado')).toBe(true);
  });
});
