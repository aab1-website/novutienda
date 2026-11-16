// «Sin precio en un mercado»: un producto al que le falta la clave de precio de un mercado declarado (caso de un mercado agregado
// a un comercio que ya tenía productos) queda sin precio en ese mercado; el resto del comercio sigue funcionando. Un producto
// NUEVO se trata como siempre: el alta exige todos los precios y la importación sin precio lo deja en 0.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  actualizarProducto, EntradaInvalida, exportarProductosCsv, importarProductosCsv, leerDocumentoProducto, leerProducto, mercadosSinPrecio, precioEnMercado,
  ProductoCorrupto, simularImportacionCsv,
} from './api.js';
import type { DobleDb } from './doble-db.js';
import { ADM, COMERCIAL_TRES, COMERCIAL_UN_MERCADO, doc, nuevoEntorno, op, producto, T } from './entorno.js';
import { accionesInventarios } from '../../plataforma/funciones/servidor/llamadas/inventarios.js';
import type { ConfiguracionComercial } from '@novutienda/nucleo';

const PE = COMERCIAL_UN_MERCADO.mercados[0]!;
// El comercio ya tenía BO y AR y agrega PE: el mercado nuevo no tiene precios en lo ya guardado.
const COMERCIAL_TRES_PE: ConfiguracionComercial = { mercados: [...COMERCIAL_TRES.mercados, PE], monedas: ['BOB', 'USD', 'ARS', 'PEN'] };
const base = { nombre: 'x', activo: true, conSerie: false };

let db: DobleDb;
beforeEach(async () => {
  db = await nuevoEntorno();
});

const sembrar = (id: string, precioUSD: Record<string, number>): void => {
  db.poner(`tenants/${T}/skus/SKU-${id}`, { productoId: id });
  db.poner(`tenants/${T}/productos/${id}`, { nombre: `Producto ${id}`, categoria: 'c', sku: `SKU-${id}`, activo: true, publicado: false, conSerie: false, precioUSD, bajoMinimo: false, version: 1 });
};

describe('lectura', () => {
  it('un mercado declarado sin clave no lanza: precioEnMercado da null y mercadosSinPrecio lo nombra', () => {
    const p = leerDocumentoProducto('x', { ...base, precioUSD: { bo: 100, ar: 200 } }, COMERCIAL_TRES_PE);
    expect({ ...p.precioCentavos }).toEqual({ bo: 100, ar: 200 });
    expect(precioEnMercado(p, 'PE')).toBeNull();
    expect(precioEnMercado(p, 'BO')).toBe(100);
    expect(mercadosSinPrecio(p, COMERCIAL_TRES_PE)).toEqual(['PE']);
    expect(mercadosSinPrecio(p, COMERCIAL_TRES)).toEqual([]);
  });
  it('un valor presente pero inválido sigue siendo corrupto', () => {
    for (const pe of [null, -1, 1.5, '3']) {
      expect(() => leerDocumentoProducto('x', { ...base, precioUSD: { bo: 1, ar: 1, pe } }, COMERCIAL_TRES_PE)).toThrow(ProductoCorrupto);
    }
  });
  it('sin configuración todo sigue igual: exige bo y ar', () => {
    expect(() => leerDocumentoProducto('x', { ...base, precioUSD: { bo: 1 } })).toThrow(ProductoCorrupto);
    expect({ ...leerDocumentoProducto('x', { ...base, precioUSD: { bo: 1, ar: 2 } }).precioCentavos }).toEqual({ bo: 1, ar: 2 });
  });
});

describe('llamadas', () => {
  const firestore = {
    collection: (r: string) => ({ get: () => Promise.resolve({ docs: db.coleccion(r).map((x) => ({ id: x.ruta.split('/').at(-1)!, data: () => x.datos, exists: true })) }) }),
    doc: (r: string) => ({ get: () => Promise.resolve({ id: r.split('/').at(-1)!, exists: db.dato(r) !== undefined, data: () => db.dato(r) }) }),
  };
  const ctx = (comercial: ConfiguracionComercial) => ({ tenantId: T, rol: 'adm', sesion: { uid: 'u-adm' }, e: { db, firestore, comercialDelTenant: () => Promise.resolve(comercial) } }) as never;

  it('listarProductos con dos mercados lista el producto que solo tiene uno, con sinPrecio', async () => {
    const dosMercados: ConfiguracionComercial = { mercados: [COMERCIAL_TRES.mercados[0]!, PE], monedas: ['BOB', 'USD', 'PEN'] };
    sembrar('prod-a', { bo: 100 });
    sembrar('b', { bo: 100, pe: 300 });
    const r = (await accionesInventarios['listarProductos']?.ejecutar(ctx(dosMercados), {})) as { productos: { id: string; sinPrecio: string[]; precioCentavosUSD: Record<string, number> }[] };
    const por = new Map(r.productos.map((p) => [p.id, p]));
    expect(por.get('prod-a')?.sinPrecio).toEqual(['PE']);
    expect(por.get('prod-a')?.precioCentavosUSD).toEqual({ bo: 100 });
    expect(por.get('b')?.sinPrecio).toEqual([]);
  });

  it('conteo abierto funciona en un comercio de un solo mercado', async () => {
    sembrar('prod-a', { pe: 300 });
    db.poner(`tenants/${T}/productos/prod-a`, { ...db.dato(`tenants/${T}/productos/prod-a`)!, stockTotal: 0 });
    db.poner(`tenants/${T}/conteos/c1`, { estado: 'abierto' });
    const f = firestore as unknown as { collection: (r: string) => Record<string, unknown> };
    const base = f.collection.bind(f);
    f.collection = (r: string) => ({ ...base(r), where: () => ({ limit: () => base(r) }) });
    const r = (await accionesInventarios['conteo']?.ejecutar(ctx(COMERCIAL_UN_MERCADO), { conteoId: 'c1' })) as { productos: { productoId: string }[] };
    expect(r.productos.map((p) => p.productoId)).toEqual(['prod-a']);
  });

  it('exportarCsv deja la clave ausente fuera (sin 0)', async () => {
    sembrar('prod-a', { bo: 100, ar: 200 });
    const r = (await accionesInventarios['exportarCsv']?.ejecutar(ctx(COMERCIAL_TRES_PE), {})) as { csv: string };
    const fila = r.csv.split('\r\n')[1]!.split(',');
    expect(fila.slice(7, 10)).toEqual(['1.00', '2.00', '']);
  });
});

describe('edición', () => {
  const editar = (precioUSD: Record<string, number>) =>
    db.runTransaction((tx) => actualizarProducto(tx, { tenantId: T, operacionId: op('ed'), por: ADM, productoId: 'prod-a', cambios: { precioUSD: precioUSD as never }, comercial: COMERCIAL_TRES_PE }));

  it('omitir un mercado sin precio lo conserva ausente', async () => {
    sembrar('prod-a', { bo: 100, ar: 200 });
    await editar({ bo: 150, ar: 200 });
    expect(doc(db, 'productos', 'prod-a')?.['precioUSD']).toEqual({ bo: 150, ar: 200 });
  });
  it('se puede poner el precio del mercado nuevo', async () => {
    sembrar('prod-a', { bo: 100, ar: 200 });
    await editar({ bo: 100, ar: 200, pe: 900 });
    expect(doc(db, 'productos', 'prod-a')?.['precioUSD']).toEqual({ bo: 100, ar: 200, pe: 900 });
  });
  it('omitir un mercado que sí tiene precio se rechaza', async () => {
    sembrar('prod-a', { bo: 100, ar: 200 });
    await expect(editar({ bo: 150 })).rejects.toThrow(/No se puede quitar el precio de AR/);
    await expect(editar({ bo: 150 })).rejects.toBeInstanceOf(EntradaInvalida);
  });
  it('el alta sigue exigiendo todos los mercados', async () => {
    const { crearProducto } = await import('./api.js');
    await expect(db.runTransaction((tx) => crearProducto(tx, { tenantId: T, operacionId: op('al'), por: ADM, producto: { ...producto('n1'), precioUSD: { bo: 1, ar: 1 } as never }, comercial: COMERCIAL_TRES_PE }))).rejects.toThrow(/Falta el precio del mercado PE/);
  });
});

describe('importación y exportación', () => {
  const imp = (csv: string) => db.runTransaction((tx) => importarProductosCsv(tx, { catalogo: sinCatalogo, tenantId: T, operacionId: op('imp'), por: ADM, csv, comercial: COMERCIAL_TRES_PE }));

  it('cambiar solo un mercado de un producto existente deja el otro ausente, no en 0', async () => {
    sembrar('prod-a', { bo: 100, ar: 200 });
    await imp('id,nombre,categoria,sku,precioBO\nprod-a,Producto prod-a,c,SKU-prod-a,2.50\n');
    expect(doc(db, 'productos', 'prod-a')?.['precioUSD']).toEqual({ bo: 250, ar: 200 });
  });
  it('un producto nuevo importado sin precio queda en 0 «a consultar»', async () => {
    await imp('id,nombre,categoria,sku\nprod-n,Nuevo,c,SKU-prod-n\n');
    expect(doc(db, 'productos', 'prod-n')?.['precioUSD']).toEqual({ bo: 0, ar: 0, pe: 0 });
  });
  it('la exportación deja la celda vacía y la vuelta no cambia nada', async () => {
    sembrar('prod-a', { bo: 100, ar: 200 });
    const leido = await db.runTransaction((tx) => leerProducto(tx, T, 'prod-a', COMERCIAL_TRES_PE));
    const csv = exportarProductosCsv([{ id: 'prod-a', nombre: 'Producto prod-a', categoria: 'c', sku: 'SKU-prod-a', conSerie: false, precioUSD: { ...leido!.precioCentavos }, activo: true, publicado: false }], COMERCIAL_TRES_PE);
    expect(csv.split('\r\n')[1]).toContain(',1.00,2.00,,');
    const sim = await db.runTransaction((tx) => simularImportacionCsv(tx, { catalogo: sinCatalogo, tenantId: T, por: ADM, csv, comercial: COMERCIAL_TRES_PE }));
    expect(sim.filas[0]?.accion).toBe('sin-cambios');
  });
});

/** Sin productos previos que reconocer: el catálogo es explícito, nunca se omite. */
const sinCatalogo = (): Promise<never[]> => Promise.resolve([]);
