// Mercados del tenant (plano §6.10): Inventarios exige un precio por CADA mercado declarado y por NINGUNO más, lee y exporta
// por mercado y decide la fecha con la zona del tenant. El tenant de tres monedas (BO y AR) se prueba idéntico en el resto de
// las suites; aquí, un comercio de UN mercado sin tipo de cambio y los casos de falla cerrado.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  actualizarProducto, aplicarSalida, claveDePrecio, columnasDeExportacion, EntradaInvalida, EstadoInvalido, exportarProductosCsv,
  fijarReloj, importarCsvPorLotes, importarProductosCsv, leerCsvFilas, leerDocumentoProducto, leerProducto, prepararSalida, ProductoCorrupto,
  simularImportacionCsv, zonaPrincipalDe,
} from './api.js';
import type { DobleDb } from './doble-db.js';
import { ADM, altaProducto, CAJ, cargar, COMERCIAL_TRES, COMERCIAL_UN_MERCADO, doc, nuevoEntorno, op, producto, T } from './entorno.js';
import { accionesInventarios } from '../../plataforma/funciones/servidor/llamadas/inventarios.js';

const UNO = { estado: 'activo', plan: 'base', modulos: {}, comercial: COMERCIAL_UN_MERCADO };
const pe = (id: string, extra = {}) => ({ ...producto(id, extra), precioUSD: { pe: 1500 } as never });

let db: DobleDb;
beforeEach(async () => {
  db = await nuevoEntorno();
});
const conUnMercado = (): void => db.poner(`tenants/${T}`, UNO);

describe('claveDePrecio', () => {
  it('es el id en minúsculas: BO -> bo, AR -> ar (lo ya guardado) y un id nuevo con la misma regla', () => {
    expect(claveDePrecio('BO')).toBe('bo');
    expect(claveDePrecio('AR')).toBe('ar');
    expect(claveDePrecio('PE')).toBe('pe');
  });
});

describe('tenant de tres monedas: columnas de siempre', () => {
  it('la exportación emite precioBO y precioAR en ese orden', () => {
    expect(columnasDeExportacion(COMERCIAL_TRES)).toEqual(['id', 'nombre', 'categoria', 'marca', 'sku', 'conSerie', 'garantiaMeses', 'minimo', 'precioBO', 'precioAR', 'costo', 'activo', 'publicado']);
  });
  it('acepta precioBO, precioBOusd, precio_bo (USD) y precioUSDbo (centavos)', () => {
    const f = leerCsvFilas('id,nombre,categoria,sku,precioBOusd,precio_ar\na1,A,c,S-1,12.50,1.10\n', false, COMERCIAL_TRES).filas;
    expect(f[0]?.datos.precios).toEqual({ bo: 1250, ar: 110 });
    const g = leerCsvFilas('id,nombre,categoria,sku,precioUSDbo,precioUSDar\na1,A,c,S-1,1250,110\n', false, COMERCIAL_TRES).filas;
    expect(g[0]?.datos.precios).toEqual({ bo: 1250, ar: 110 });
  });
});

describe('comercio de UN mercado (PE, sin tipo de cambio)', () => {
  beforeEach(conUnMercado);

  it('crea un producto con un solo precio, guardado con la clave del mercado', async () => {
    await altaProducto(db, pe('lapiz'));
    expect(doc(db, 'productos', 'lapiz')?.['precioUSD']).toEqual({ pe: 1500 });
  });

  it('rechaza el precio de un mercado no declarado, y el que falta', async () => {
    await expect(altaProducto(db, { ...pe('x1'), precioUSD: { pe: 1, bo: 2 } as never })).rejects.toThrow(/Mercado desconocido en el precio: bo/);
    await expect(altaProducto(db, { ...pe('x2'), precioUSD: { bo: 1, ar: 2 } as never })).rejects.toThrow(/Falta el precio del mercado PE/);
    await expect(altaProducto(db, { ...pe('x3'), precioUSD: {} as never })).rejects.toBeInstanceOf(EntradaInvalida);
  });

  it('edita el precio y la auditoría usa el sufijo del mercado; otro mercado se rechaza', async () => {
    await altaProducto(db, pe('lapiz'));
    await db.runTransaction((tx) => actualizarProducto(tx, { tenantId: T, operacionId: op('ed'), por: ADM, productoId: 'lapiz', cambios: { precioUSD: { pe: 2000 } as never } }));
    expect(doc(db, 'productos', 'lapiz')?.['precioUSD']).toEqual({ pe: 2000 });
    const a = db.coleccion(`tenants/${T}/auditoria`).filter((x) => x.datos['accion'] === 'inventarios.producto-precio').at(-1);
    expect(a?.datos['resumenDespues']).toMatchObject({ antesPe: 1500, precioPe: 2000 });
    await expect(db.runTransaction((tx) => actualizarProducto(tx, { tenantId: T, operacionId: op('ed'), por: ADM, productoId: 'lapiz', cambios: { precioUSD: { pe: 1, ar: 1 } as never } }))).rejects.toBeInstanceOf(EntradaInvalida);
  });

  it('la lectura entrega solo los precios de los mercados declarados', async () => {
    await altaProducto(db, pe('lapiz'));
    const leido = await db.runTransaction((tx) => leerProducto(tx, T, 'lapiz', COMERCIAL_UN_MERCADO));
    expect({ ...leido?.precioCentavos }).toEqual({ pe: 1500 });
    // Un documento al que le falta el precio de un mercado declarado está corrupto (falla cerrado).
    expect(() => leerDocumentoProducto('x', { nombre: 'x', activo: true, conSerie: false, precioUSD: { bo: 1 } }, COMERCIAL_UN_MERCADO)).toThrow(ProductoCorrupto);
  });

  it('la importación acepta solo su columna y avisa que ignora las de otros mercados', async () => {
    const csv = 'id,nombre,categoria,sku,precioPE,precioBO\nlapiz,Lápiz,c,L-1,12.50,9.99\n';
    const sim = await db.runTransaction((tx) => simularImportacionCsv(tx, { tenantId: T, por: ADM, csv }));
    expect(sim.columnasIgnoradas).toEqual(['precioBO']);
    expect(sim.filas[0]?.accion).toBe('crear');
    const r = await importarCsvPorLotes(db, { tenantId: T, operacionId: op('imp'), por: ADM, csv });
    expect(r).toMatchObject({ completa: true, creados: 1 });
    expect(doc(db, 'productos', 'lapiz')?.['precioUSD']).toEqual({ pe: 1250 });
    await db.runTransaction((tx) => importarProductosCsv(tx, { tenantId: T, operacionId: op('imp'), por: ADM, csv: 'id,nombre,categoria,sku,precioPENpe\nboli,Bolí,c,B-1,300\n' }));
    expect(doc(db, 'productos', 'boli')?.['precioUSD']).toEqual({ pe: 300 });
  });

  it('la exportación emite solo su columna y la vuelta no cambia nada', async () => {
    await altaProducto(db, pe('lapiz'));
    const csv = exportarProductosCsv([{ id: 'lapiz', nombre: 'Producto lapiz', categoria: 'general', sku: 'SKU-lapiz', conSerie: false, precioUSD: { pe: 1500 }, activo: true, publicado: false }], COMERCIAL_UN_MERCADO);
    expect(csv.split('\r\n')[0]).toBe('id,nombre,categoria,marca,sku,conSerie,garantiaMeses,minimo,precioPE,costo,activo,publicado');
    expect(csv.split('\r\n')[1]).toContain(',15.00,');
    const sim = await db.runTransaction((tx) => simularImportacionCsv(tx, { tenantId: T, por: ADM, csv }));
    expect(sim.columnasIgnoradas).toEqual([]);
    expect(sim.filas[0]?.accion).toBe('sin-cambios');
  });

  it('la fecha de la garantía usa la zona del tenant (Lima), no La Paz', async () => {
    await altaProducto(db, pe('celular', { conSerie: true, garantiaMeses: 12 }));
    await cargar(db, 'celular', 'tienda', 1, ['A']);
    // 04:30 UTC: en Lima (UTC-5) aún es el 4 de noviembre; en La Paz (UTC-4) ya sería el 5.
    fijarReloj(() => Date.UTC(2026, 10, 5, 4, 30, 0));
    expect(zonaPrincipalDe(COMERCIAL_UN_MERCADO)).toBe('America/Lima');
    await db.runTransaction(async (tx) => {
      const plan = await prepararSalida(tx, T, [{ productoId: 'celular', almacenId: 'tienda', cantidad: 1, series: ['A'] }]);
      aplicarSalida(tx, plan, { tipo: 'venta', id: 'v-1' }, CAJ);
    });
    expect(doc(db, 'unidades', 'celular__A')?.['garantiaHasta']).toBe('2027-11-04');
  });

  it('el callable valida la forma y deja la regla de mercados a Inventarios, con la configuración inyectada', async () => {
    const ctx = { tenantId: T, rol: 'adm', sesion: { uid: 'u-adm' }, e: { db, comercialDelTenant: () => Promise.resolve(COMERCIAL_UN_MERCADO) } } as never;
    const A = accionesInventarios;
    await A['crearProducto']?.ejecutar(ctx, { operacionId: 'c1', producto: { id: 'regla', nombre: 'Regla', categoria: 'util', sku: 'REG', precioUSD: { pe: 700 } } });
    expect(doc(db, 'productos', 'regla')?.['precioUSD']).toEqual({ pe: 700 });
    await expect((async () => A['crearProducto']?.ejecutar(ctx, { operacionId: 'c2', producto: { id: 'otra', nombre: 'O', categoria: 'u', sku: 'OTR', precioUSD: { pe: 1, bo: 1 } } }))()).rejects.toThrow(/desconocido/);
  });
});

describe('falla cerrado: sin configuración comercial válida no hay operación', () => {
  it('tenant sin comercial ni forma anterior', async () => {
    db.poner(`tenants/${T}`, { estado: 'activo', plan: 'base', modulos: {} });
    await expect(altaProducto(db, producto('x1'))).rejects.toBeInstanceOf(EstadoInvalido);
  });
  it('tenant inexistente', async () => {
    db.poner(`tenants/${T}`, undefined);
    await expect(altaProducto(db, producto('x1'))).rejects.toBeInstanceOf(EstadoInvalido);
    await expect(db.runTransaction((tx) => simularImportacionCsv(tx, { tenantId: T, por: ADM, csv: 'id,nombre\na,b\n' }))).rejects.toBeInstanceOf(EstadoInvalido);
  });
  it('comercial inválido (mercado sin moneda de venta declarada)', async () => {
    db.poner(`tenants/${T}`, { ...UNO, comercial: { mercados: [{ id: 'pe' }], monedas: ['PEN'] } });
    await expect(altaProducto(db, producto('x1'))).rejects.toBeInstanceOf(EstadoInvalido);
  });
  it('el callable propaga el error de configuración del lector (nunca asume el tenant de tres monedas)', async () => {
    const ctx = { tenantId: T, rol: 'adm', sesion: { uid: 'u' }, e: { db, comercialDelTenant: () => Promise.reject(new Error('sin comercial')) } } as never;
    await expect((async () => accionesInventarios['crearProducto']?.ejecutar(ctx, { operacionId: 'c1', producto: { id: 'a1', nombre: 'A', categoria: 'c', sku: 'A1', precioUSD: { bo: 1, ar: 1 } } }))()).rejects.toThrow('sin comercial');
  });
  it('prepararSalida con garantía y sin configuración falla, no asume La Paz', async () => {
    await altaProducto(db, producto('celular', { conSerie: true, garantiaMeses: 12 }));
    await cargar(db, 'celular', 'tienda', 1, ['A']);
    db.poner(`tenants/${T}`, { estado: 'activo', plan: 'base', modulos: {} });
    await expect(db.runTransaction((tx) => prepararSalida(tx, T, [{ productoId: 'celular', almacenId: 'tienda', cantidad: 1, series: ['A'] }]))).rejects.toBeInstanceOf(EstadoInvalido);
  });
});
