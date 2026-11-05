// La consola frente a Inventarios REAL (por los adaptadores de la plataforma): campos alineados, alta y auditoría
// atómicas, conversión de unidades y SKU derivado. Reutiliza el entorno de integración (solo lectura de sus ayudas).
import { crearProductoConsola, editarProductoConsola, validarDatosProducto } from '@novutienda/consola';
import { skuDesdeId } from '@novutienda/inventarios';
import type { Actor, BaseDatosIdentidad } from '@novutienda/nucleo';
import { beforeEach, describe, expect, it } from 'vitest';
import { centavosADolares, dolaresACentavos } from '../../plataforma/adaptadores/index.js';
import { T, doc, entornoListo, type Entorno } from '../integracion/entorno.js';

const admin: Actor = { uid: 'u-adm', claims: { firebase: { sign_in_provider: 'password' }, pl: { t: { [T]: 'adm' }, v: 1 } } };
const datos = (extra: object = {}) => ({ nombre: 'Taladro 500 W', categoria: 'herramientas', activo: true, ...extra });

let e: Entorno;
beforeEach(async () => {
  e = await entornoListo();
});

/** Base que hace fallar la escritura que cumpla `falla`, después de que las demás ya se pidieron en la misma transacción. */
const dbQueFalla = (falla: (ruta: string) => boolean): BaseDatosIdentidad => ({
  runTransaction: (fn) =>
    e.db.runTransaction((tx) =>
      fn({
        ...tx,
        set: (ruta, d) => {
          if (falla(ruta)) throw new Error('falla simulada');
          tx.set(ruta, d);
        },
        create: (ruta, d) => {
          if (falla(ruta)) throw new Error('falla simulada');
          tx.create(ruta, d);
        },
      }),
    ),
});

describe('validación de la consola alineada con Inventarios', () => {
  it('garantiaMeses de 1 a 120 y el SKU con el formato de Inventarios', () => {
    expect(() => validarDatosProducto(datos({ garantiaMeses: 0 }), true)).toThrow();
    expect(() => validarDatosProducto(datos({ garantiaMeses: 121 }), true)).toThrow();
    expect(validarDatosProducto(datos({ garantiaMeses: 120 }), true)).toMatchObject({ garantiaMeses: 120 });
    expect(validarDatosProducto(datos({ garantiaMeses: 1 }), true)).toMatchObject({ garantiaMeses: 1 });
    expect(() => validarDatosProducto(datos({ sku: '-malo' }), true)).toThrow();
    expect(validarDatosProducto(datos({ sku: 'OK-1' }), true)).toMatchObject({ sku: 'OK-1' });
  });

  it('crea con conSerie, minimo y publicado; minimo y publicado se editan; conSerie y sku no', () => {
    expect(validarDatosProducto(datos({ conSerie: true, minimo: 3, publicado: true }), true)).toMatchObject({ conSerie: true, minimo: 3, publicado: true });
    expect(validarDatosProducto({ minimo: 0, publicado: false }, false)).toEqual({ minimo: 0, publicado: false });
    const error = (() => {
      try {
        validarDatosProducto({ sku: 'X-1' }, false);
      } catch (x) {
        return x;
      }
      return undefined;
    })();
    expect((error as { detalles: string[] }).detalles.join(' ')).toContain('sku: no se edita');
    expect(() => validarDatosProducto({ conSerie: true }, false)).toThrow();
    expect(() => validarDatosProducto(datos({ minimo: -1 }), true)).toThrow();
    expect(() => validarDatosProducto(datos({ minimo: 1.5 }), true)).toThrow();
  });
});

describe('SKU derivado del id', () => {
  it('un id largo recibe un SKU válido, único y determinista', async () => {
    const id = `taladro-${'x'.repeat(50)}`;
    const deps = { db: e.db, catalogo: e.catalogoConsola, reloj: { ahora: () => e.reloj.ahora } };
    await crearProductoConsola(deps, { tenantId: T, actor: admin, productoId: id, datos: datos(), precioUSD: { bo: 1, ar: 1 } });
    const sku = skuDesdeId(id);
    expect(sku).toHaveLength(40);
    expect(doc(e, T, `productos/${id}`)).toMatchObject({ sku });
    expect(doc(e, T, `skus/${sku}`)).toBeDefined();
  });
});

describe('conversión de precios (única, en el adaptador)', () => {
  it('USD decimales <-> centavos enteros', () => {
    expect(dolaresACentavos(12.5)).toBe(1250);
    expect(dolaresACentavos(13.25)).toBe(1325);
    expect(dolaresACentavos(0.07)).toBe(7); // sin error de coma flotante
    expect(centavosADolares(1325)).toBe(13.25);
    expect(centavosADolares(dolaresACentavos(99.99))).toBe(99.99);
  });

  it('el catálogo entrega USD decimales y Inventarios guarda centavos', async () => {
    const deps = { db: e.db, catalogo: e.catalogoConsola, reloj: { ahora: () => e.reloj.ahora } };
    await crearProductoConsola(deps, { tenantId: T, actor: admin, productoId: 'sierra', datos: datos(), precioUSD: { bo: 12.5, ar: 0.07 } });
    expect(doc(e, T, 'productos/sierra')).toMatchObject({ precioUSD: { bo: 1250, ar: 7 } });
    expect((await e.catalogoConsola.leerProducto(T, 'sierra'))?.precioUSD).toEqual({ bo: 12.5, ar: 0.07 });
  });
});

describe('alta y auditoría atómicas (I-14)', () => {
  const sitio = (): unknown => doc(e, T, 'sitio/estado');
  const auditorias = (): number => e.db.coleccion(`tenants/${T}/auditoria`).length;

  it('si falla la auditoría, el producto, el SKU, el cupo y la anotación del cambio no quedan', async () => {
    const antes = { sitio: sitio(), contador: doc(e, T, 'contadores/uso'), auditorias: auditorias() };
    const deps = { db: dbQueFalla((r) => r.includes('/auditoria/')), catalogo: e.catalogoConsola, reloj: { ahora: () => e.reloj.ahora } };
    await expect(crearProductoConsola(deps, { tenantId: T, actor: admin, productoId: 'taladro', datos: datos(), precioUSD: { bo: 1, ar: 1 } })).rejects.toThrow('falla simulada');
    expect(doc(e, T, 'productos/taladro')).toBeUndefined();
    expect(doc(e, T, 'skus/taladro')).toBeUndefined();
    expect(doc(e, T, 'operaciones/consola-crear-taladro')).toBeUndefined();
    expect(doc(e, T, 'contadores/uso')).toEqual(antes.contador);
    expect(sitio()).toEqual(antes.sitio);
    expect(auditorias()).toBe(antes.auditorias);
  });

  it('si falla la anotación del cambio, la edición de Inventarios tampoco queda', async () => {
    const antes = doc(e, T, 'productos/lapiz');
    const antesAud = auditorias();
    const deps = { db: dbQueFalla((r) => r.endsWith('/sitio/estado')), catalogo: e.catalogoConsola, reloj: { ahora: () => e.reloj.ahora } };
    await expect(editarProductoConsola(deps, { tenantId: T, actor: admin, productoId: 'lapiz', cambios: { nombre: 'Otro nombre', activo: false } })).rejects.toThrow('falla simulada');
    expect(doc(e, T, 'productos/lapiz')).toEqual(antes);
    expect(doc(e, T, 'existenciasPublicas/lapiz')?.['disponible']).toBe(true);
    expect(auditorias()).toBe(antesAud);
  });

  it('sin fallas, todo queda junto: producto, anotación de cambio y auditoría', async () => {
    const antesAud = auditorias();
    const deps = { db: e.db, catalogo: e.catalogoConsola, reloj: { ahora: () => e.reloj.ahora } };
    await crearProductoConsola(deps, { tenantId: T, actor: admin, productoId: 'taladro', datos: datos(), precioUSD: { bo: 1, ar: 1 } });
    expect(doc(e, T, 'productos/taladro')).toBeDefined();
    expect(sitio()).toMatchObject({ cambios: 1 });
    expect(e.db.coleccion(`tenants/${T}/auditoria`).filter((a) => a.datos['accion'] === 'producto.crear')).toHaveLength(1);
    expect(auditorias()).toBeGreaterThan(antesAud);
  });
});
