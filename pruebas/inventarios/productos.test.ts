import { beforeEach, describe, expect, it } from 'vitest';
import { LimiteDelPlan } from '@novutienda/nucleo';
import { actualizarProducto, crearProducto, EntradaInvalida, EstadoInvalido, SinPermiso } from './api.js';
import { accionesInventarios } from '../../plataforma/funciones/servidor/llamadas/inventarios.js';
import { tablasCompuestas } from '../funciones/tablas.js';
import type { DobleDb } from './doble-db.js';
import { ADM, altaProducto, cargar, CAJ, COMERCIAL_TRES, contar, doc, nuevoEntorno, op, producto, SUP, T } from './entorno.js';

let db: DobleDb;
beforeEach(async () => {
  db = await nuevoEntorno();
  await altaProducto(db, producto('lapiz', { marca: 'Faber', garantiaMeses: 6, minimo: 5, costoUSD: 250 }));
});

const editar = (cambios: Parameters<typeof actualizarProducto>[1]['cambios'], por = ADM, productoId = 'lapiz') =>
  db.runTransaction((tx) => actualizarProducto(tx, { tenantId: T, operacionId: op('ed'), por, productoId, cambios }));
const auditoria = (accion: string) => db.coleccion(`tenants/${T}/auditoria`).filter((a) => a.datos['accion'] === accion);

describe('alta de producto', () => {
  it('crea, audita con los precios y sube el contador del plan', async () => {
    await altaProducto(db, producto('goma', { precioUSD: { bo: 500, ar: 600 } }));
    expect(doc(db, 'productos', 'goma')?.['precioUSD']).toEqual({ bo: 500, ar: 600 });
    const a = auditoria('inventarios.producto-crear').at(-1);
    expect(a?.datos['resumenDespues']).toMatchObject({ precioBo: 500, precioAr: 600 });
  });
  it('rechaza precio incompleto o con mercado desconocido', async () => {
    await expect(altaProducto(db, { ...producto('x1'), precioUSD: { bo: 1 } as never })).rejects.toBeInstanceOf(EntradaInvalida);
    await expect(altaProducto(db, { ...producto('x2'), precioUSD: { bo: 1, ar: 1, xx: 1 } as never })).rejects.toBeInstanceOf(EntradaInvalida);
  });
  it('respeta el límite del plan', async () => {
    for (let i = 2; i <= 200; i++) await altaProducto(db, producto(`p-${String(i)}`));
    await expect(altaProducto(db, producto('p-201'))).rejects.toBeInstanceOf(LimiteDelPlan);
  });
  it('solo adm', async () => {
    for (const por of [SUP, CAJ]) {
      await expect(db.runTransaction((tx) => crearProducto(tx, { tenantId: T, operacionId: op(), por, producto: producto('nuevo') }))).rejects.toBeInstanceOf(SinPermiso);
    }
  });
});

describe('edición', () => {
  it('null vacía marca, garantía, mínimo y costo; undefined no cambia', async () => {
    await editar({ marca: null, garantiaMeses: null, minimo: null, costoUSD: null } as never);
    const p = doc(db, 'productos', 'lapiz');
    expect(p).not.toHaveProperty('marca');
    expect(p).not.toHaveProperty('garantiaMeses');
    expect(p).not.toHaveProperty('minimo');
    expect(p?.['nombre']).toBe('Producto lapiz');
    expect(p?.['bajoMinimo']).toBe(false);
    expect(doc(db, 'costos', 'lapiz')?.['costoUSD']).toBeUndefined();
  });
  it('vaciar el mínimo recalcula bajoMinimo', async () => {
    await cargar(db, 'lapiz', 'tienda', 2);
    expect(doc(db, 'productos', 'lapiz')?.['bajoMinimo']).toBe(true);
    await editar({ minimo: null });
    expect(doc(db, 'productos', 'lapiz')?.['bajoMinimo']).toBe(false);
  });
  it('nombre, categoría y precio no se vacían', async () => {
    await expect(editar({ nombre: null as never })).rejects.toBeInstanceOf(EntradaInvalida);
    await expect(editar({ categoria: null as never })).rejects.toBeInstanceOf(EntradaInvalida);
    await expect(editar({ precioUSD: null as never })).rejects.toBeInstanceOf(EntradaInvalida);
  });
  it('permisos: solo adm; auditoría de precio con antes y después', async () => {
    await expect(editar({ nombre: 'x' }, SUP)).rejects.toBeInstanceOf(SinPermiso);
    await expect(editar({ nombre: 'x' }, CAJ)).rejects.toBeInstanceOf(SinPermiso);
    await editar({ precioUSD: { bo: 2000, ar: 2100 } });
    expect(auditoria('inventarios.producto-precio').at(-1)?.datos['resumenDespues']).toMatchObject({ antesBo: 1000, antesAr: 1100, precioBo: 2000, precioAr: 2100 });
  });
  it('conSerie tras el primer movimiento da un mensaje claro', async () => {
    await cargar(db, 'lapiz', 'tienda', 1);
    const r = editar({ conSerie: true });
    await expect(r).rejects.toBeInstanceOf(EstadoInvalido);
    await expect(r).rejects.toThrow(/ya tiene movimientos/);
  });
});

describe('callables inventarios.*Producto', () => {
  const ctx = (rol: string) => ({ tenantId: T, rol, sesion: { uid: `u-${rol}` }, e: { db, comercialDelTenant: () => Promise.resolve(COMERCIAL_TRES) } }) as never;
  it('el registro da solo adm a las tres acciones', () => {
    const t = tablasCompuestas()['inventarios'] ?? {};
    for (const n of ['crearProducto', 'editarProducto', 'cambiarPrecioUSD']) expect(t[n]?.roles).toEqual(['adm']);
  });
  it('alta, edición con null y precio; esquema estricto', async () => {
    const A = accionesInventarios;
    await A['crearProducto']?.ejecutar(ctx('adm'), { operacionId: 'c1', producto: { id: 'regla', nombre: 'Regla', categoria: 'util', sku: 'REG', precioUSD: { bo: 1, ar: 2 } } });
    expect(contar(db, 'productos')).toBe(2);
    await A['editarProducto']?.ejecutar(ctx('adm'), { operacionId: 'c2', productoId: 'lapiz', cambios: { marca: null, minimo: null } });
    expect(doc(db, 'productos', 'lapiz')).not.toHaveProperty('marca');
    await A['cambiarPrecioUSD']?.ejecutar(ctx('adm'), { operacionId: 'c3', productoId: 'lapiz', precioUSD: { bo: 5, ar: 6 } });
    expect(doc(db, 'productos', 'lapiz')?.['precioUSD']).toEqual({ bo: 5, ar: 6 });
    await expect((async () => A['cambiarPrecioUSD']?.ejecutar(ctx('adm'), { operacionId: 'c4', productoId: 'lapiz', precioUSD: { bo: 5 } }))()).rejects.toThrow();
    await expect((async () => A['editarProducto']?.ejecutar(ctx('adm'), { operacionId: 'c5', productoId: 'lapiz', cambios: { sku: 'X' } }))()).rejects.toThrow();
    await expect((async () => A['crearProducto']?.ejecutar(ctx('sup'), { operacionId: 'c6', producto: { id: 'zz', nombre: 'Z', categoria: 'u', sku: 'ZZ', precioUSD: { bo: 1, ar: 2 } } }))()).rejects.toThrow();
  });
});
