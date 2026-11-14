import { beforeEach, describe, expect, it } from 'vitest';
import {
  actualizarProducto, aplicarSalida, EntradaInvalida, esDisponible, exportarProductosCsv, fechaLocal, fijarReloj, importarProductosCsv, leerExistencias,
  leerProducto, prepararSalida, ProductoCorrupto, skuDesdeId, traspasar, validarEntradaProducto,
} from './api.js';
import type { DobleDb } from './doble-db.js';
import { ADM, altaProducto, COMERCIAL_TRES, CAJ, cargar, doc, nuevoEntorno, op, producto, SUP, T, verificarInvariantes } from './entorno.js';

let db: DobleDb;
beforeEach(async () => {
  db = await nuevoEntorno();
});

describe('marca del producto', () => {
  it('se guarda al crear, se edita, viaja por el CSV y se lee con el lector público', async () => {
    await altaProducto(db, producto('taladro', { marca: 'Bosch' }));
    expect(doc(db, 'productos', 'taladro')).toMatchObject({ marca: 'Bosch' });
    await db.runTransaction((tx) => actualizarProducto(tx, { tenantId: T, operacionId: op(), por: ADM, productoId: 'taladro', cambios: { marca: 'Makita' } }));
    expect((await db.runTransaction((tx) => leerProducto(tx, T, 'taladro')))?.marca).toBe('Makita');
    await db.runTransaction((tx) =>
      importarProductosCsv(tx, { tenantId: T, operacionId: op(), por: ADM, csv: 'id,nombre,categoria,marca,sku,precioUSDbo,precioUSDar\nsierra,Sierra,herr,=Dewalt,S-1,1,1\n' }),
    );
    expect(doc(db, 'productos', 'sierra')).toMatchObject({ marca: "'=Dewalt" });
    const csv = exportarProductosCsv([{ id: 'x1', nombre: 'X', categoria: 'c', marca: 'Bosch', sku: 'X-1', conSerie: false, precioUSD: { bo: 1, ar: 1 }, activo: true, publicado: false }]);
    expect(csv).toContain('x1,X,c,Bosch,X-1');
  });

  it('rechaza una marca vacía o demasiado larga', () => {
    const base = producto('m1');
    expect(() => validarEntradaProducto({ ...base, marca: '' }, COMERCIAL_TRES)).toThrow(EntradaInvalida);
    expect(() => validarEntradaProducto({ ...base, marca: 'x'.repeat(61) }, COMERCIAL_TRES)).toThrow(EntradaInvalida);
  });
});

describe('disponibilidad única: activo y existencia en tienda > 0', () => {
  it('función pura', () => {
    expect(esDisponible({ activo: true, stockTotal: 5 }, 1)).toBe(true);
    expect(esDisponible({ activo: true, stockTotal: 5 }, 0)).toBe(false);
    expect(esDisponible({ activo: false, stockTotal: 5 }, 9)).toBe(false);
    expect(esDisponible({ activo: true }, 0)).toBe(true); // no controla stock
    expect(esDisponible({ activo: false }, 0)).toBe(false);
  });

  it('el stock de un depósito no cuenta; un traspaso a la tienda sí; inactivar lo oculta', async () => {
    await altaProducto(db, producto('lapiz'));
    expect(doc(db, 'existenciasPublicas', 'lapiz')?.['disponible']).toBe(false);
    await cargar(db, 'lapiz', 'deposito-1', 5);
    expect(doc(db, 'existenciasPublicas', 'lapiz')?.['disponible']).toBe(false);
    await db.runTransaction((tx) =>
      traspasar(tx, { tenantId: T, operacionId: op(), por: SUP, origenId: 'deposito-1', destinoId: 'tienda', lineas: [{ productoId: 'lapiz', cantidad: 2 }] }),
    );
    expect(doc(db, 'existenciasPublicas', 'lapiz')?.['disponible']).toBe(true);
    await db.runTransaction((tx) => actualizarProducto(tx, { tenantId: T, operacionId: op(), por: ADM, productoId: 'lapiz', cambios: { activo: false } }));
    expect(doc(db, 'existenciasPublicas', 'lapiz')?.['disponible']).toBe(false);
    await db.runTransaction((tx) => actualizarProducto(tx, { tenantId: T, operacionId: op(), por: ADM, productoId: 'lapiz', cambios: { activo: true } }));
    expect(doc(db, 'existenciasPublicas', 'lapiz')?.['disponible']).toBe(true);
    verificarInvariantes(db);
  });

  it('un producto con stock solo en la tienda se agota al venderlo todo', async () => {
    await altaProducto(db, producto('goma'));
    await cargar(db, 'goma', 'tienda', 1);
    await db.runTransaction(async (tx) => {
      const plan = await prepararSalida(tx, T, [{ productoId: 'goma', almacenId: 'tienda', cantidad: 1 }]);
      aplicarSalida(tx, plan, { tipo: 'venta', id: 'v-1' }, CAJ);
    });
    expect(doc(db, 'existenciasPublicas', 'goma')?.['disponible']).toBe(false);
    verificarInvariantes(db);
  });
});

describe('garantía con fecha de calendario en La Paz', () => {
  const vender = (serie: string, zona?: string) =>
    db.runTransaction(async (tx) => {
      const plan = await prepararSalida(tx, T, [{ productoId: 'celular', almacenId: 'tienda', cantidad: 1, series: [serie] }], zona === undefined ? {} : { zonaHoraria: zona });
      aplicarSalida(tx, plan, { tipo: 'venta', id: `v-${serie}` }, CAJ);
    });

  beforeEach(async () => {
    await altaProducto(db, producto('celular', { conSerie: true, garantiaMeses: 12 }));
    await cargar(db, 'celular', 'tienda', 2, ['A', 'B']);
  });

  it('a las 22:00 en La Paz (02:00 UTC del día siguiente) cuenta el día de La Paz', async () => {
    fijarReloj(() => Date.UTC(2026, 10, 5, 2, 0, 0));
    expect(fechaLocal('2026-11-05T02:00:00.000Z', 'America/La_Paz')).toBe('2026-11-04');
    await vender('A');
    expect(doc(db, 'unidades', 'celular__A')?.['garantiaHasta']).toBe('2027-11-04');
  });

  it('la zona es inyectable', async () => {
    fijarReloj(() => Date.UTC(2026, 10, 5, 2, 0, 0));
    await vender('B', 'UTC');
    expect(doc(db, 'unidades', 'celular__B')?.['garantiaHasta']).toBe('2027-11-05');
  });

  it('acota al último día del mes (29/02 -> 28/02)', async () => {
    fijarReloj(() => Date.UTC(2028, 1, 29, 15, 0, 0));
    await db.runTransaction((tx) => actualizarProducto(tx, { tenantId: T, operacionId: op(), por: ADM, productoId: 'celular', cambios: { garantiaMeses: 12 } }));
    await vender('A');
    expect(doc(db, 'unidades', 'celular__A')?.['garantiaHasta']).toBe('2029-02-28');
  });
});

describe('lectores públicos y SKU por defecto', () => {
  it('leerProducto y leerExistencias', async () => {
    await altaProducto(db, producto('lapiz', { minimo: 2, marca: 'Faber' }));
    await cargar(db, 'lapiz', 'tienda', 3);
    const p = await db.runTransaction((tx) => leerProducto(tx, T, 'lapiz'));
    expect(p).toMatchObject({ productoId: 'lapiz', marca: 'Faber', minimo: 2, stockTotal: 3, activo: true, publicado: false, precioCentavos: { bo: 1000, ar: 1100 } });
    expect(await db.runTransaction((tx) => leerProducto(tx, T, 'no-existe'))).toBeUndefined();
    expect(await db.runTransaction((tx) => leerExistencias(tx, T, 'lapiz'))).toEqual([{ ubicacionId: 'tienda', cantidad: 3 }]);
  });

  it('un documento corrupto se rechaza', async () => {
    db.poner(`tenants/${T}/productos/roto`, { nombre: 'x', activo: true, conSerie: false, precioUSD: { bo: 1.5, ar: 1 } });
    await expect(db.runTransaction((tx) => leerProducto(tx, T, 'roto'))).rejects.toBeInstanceOf(ProductoCorrupto);
  });

  it('skuDesdeId es determinista y cabe en 40 caracteres', () => {
    expect(skuDesdeId('taladro')).toBe('taladro');
    const largo = 'a'.repeat(60);
    expect(skuDesdeId(largo)).toHaveLength(40);
    expect(skuDesdeId(largo)).toBe(skuDesdeId(largo));
    expect(skuDesdeId(`${'a'.repeat(59)}b`)).not.toBe(skuDesdeId(largo));
    expect(() => validarEntradaProducto({ ...producto('x1'), sku: skuDesdeId(largo) }, COMERCIAL_TRES)).not.toThrow();
  });
});
