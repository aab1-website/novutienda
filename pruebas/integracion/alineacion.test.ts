// Inventarios REAL frente a lo que lee la consola (por los adaptadores de la plataforma): conversión de unidades, y alta
// y auditoría atómicas. Los productos nacen y cambian solo por Inventarios; la consola los lee.
import { actualizarProducto, crearProducto } from '@novutienda/inventarios';
import type { BaseDatosIdentidad } from '@novutienda/nucleo';
import { beforeEach, describe, expect, it } from 'vitest';
import { centavosADolares, dolaresACentavos } from '../../plataforma/coordinador/index.js';
import { ADM, T, altaProducto, doc, entornoListo, op, producto, type Entorno } from './entorno.js';

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

describe('conversión de precios (única, en el adaptador)', () => {
  it('USD decimales <-> centavos enteros', () => {
    expect(dolaresACentavos(12.5)).toBe(1250);
    expect(dolaresACentavos(13.25)).toBe(1325);
    expect(dolaresACentavos(0.07)).toBe(7); // sin error de coma flotante
    expect(centavosADolares(1325)).toBe(13.25);
    expect(centavosADolares(dolaresACentavos(99.99))).toBe(99.99);
  });

  it('el catálogo entrega USD decimales y Inventarios guarda centavos', async () => {
    await altaProducto(e, T, producto('sierra', { precioUSD: { bo: 1250, ar: 7 } }));
    expect(doc(e, T, 'productos/sierra')).toMatchObject({ precioUSD: { bo: 1250, ar: 7 } });
    expect((await e.catalogoConsola.leerProducto(T, 'sierra'))?.precioUSD).toEqual({ bo: 12.5, ar: 0.07 });
  });
});

describe('alta y auditoría atómicas (I-14)', () => {
  const sitio = (): unknown => doc(e, T, 'sitio/estado');
  const auditorias = (): number => e.db.coleccion(`tenants/${T}/auditoria`).length;

  it('si falla la auditoría, el producto, el SKU, el cupo y la anotación del cambio no quedan', async () => {
    const antes = { sitio: sitio(), contador: doc(e, T, 'contadores/uso'), auditorias: auditorias() };
    const db = dbQueFalla((r) => r.includes('/auditoria/'));
    await expect(db.runTransaction((tx) => crearProducto(tx, { tenantId: T, operacionId: 'op-falla', por: ADM, producto: producto('taladro') }))).rejects.toThrow('falla simulada');
    expect(doc(e, T, 'productos/taladro')).toBeUndefined();
    expect(doc(e, T, 'skus/taladro')).toBeUndefined();
    expect(doc(e, T, 'operaciones/op-falla')).toBeUndefined();
    expect(doc(e, T, 'contadores/uso')).toEqual(antes.contador);
    expect(sitio()).toEqual(antes.sitio);
    expect(auditorias()).toBe(antes.auditorias);
  });

  it('si falla la publicación del evento producto.cambiado, la edición de Inventarios tampoco queda', async () => {
    const antes = doc(e, T, 'productos/lapiz');
    const antesAud = auditorias();
    const db = dbQueFalla((r) => r.includes('/eventos/'));
    await expect(db.runTransaction((tx) => actualizarProducto(tx, { tenantId: T, operacionId: op(), por: ADM, productoId: 'lapiz', cambios: { nombre: 'Otro nombre', activo: false } }))).rejects.toThrow('falla simulada');
    expect(doc(e, T, 'productos/lapiz')).toEqual(antes);
    expect(doc(e, T, 'existenciasPublicas/lapiz')?.['disponible']).toBe(true);
    expect(auditorias()).toBe(antesAud);
  });

  it('sin fallas, todo queda junto: producto, evento (que anota el cambio al entregarse) y auditoría', async () => {
    const antesAud = auditorias();
    const altasAntes = e.db.coleccion(`tenants/${T}/auditoria`).filter((a) => a.datos['accion'] === 'inventarios.producto-crear').length;
    await altaProducto(e, T, producto('taladro'));
    expect(doc(e, T, 'productos/taladro')).toBeDefined();
    expect(sitio()).toBeUndefined(); // consola ya no anota por su cuenta: lo hace el consumidor del evento
    expect(e.db.coleccion(`tenants/${T}/eventos`).filter((x) => x.datos['tipo'] === 'producto.cambiado' && (x.datos['datos'] as { productoId?: string }).productoId === 'taladro')).toHaveLength(1);
    expect(e.db.coleccion(`tenants/${T}/auditoria`).filter((a) => a.datos['accion'] === 'inventarios.producto-crear')).toHaveLength(altasAntes + 1);
    expect(auditorias()).toBeGreaterThan(antesAud);
  });
});
