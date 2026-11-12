// Visibilidad de las existencias durante un conteo abierto (`visibilidad.ts`): matriz rol × conteos abiertos × ubicación.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  abrirConteo, cerrarConteo, conteosAbiertosDe, registrarLineaConteo, filtrarUnidadesLista, hayOcultamiento, marcaOcultamiento, proyectarMovimiento, proyectarProducto, puedeVerExistencias,
  recortarFaltantes, StockInsuficiente, type Conteos, type Faltante,
} from './api.js';
import type { DobleDb } from './doble-db.js';
import { ADM, altaProducto, nuevoEntorno, op, producto, SUP, T, cargar } from './entorno.js';

const ROLES = ['caj', 'sup', 'adm'] as const;
const c = (ubicacionId: string): Conteos[number] => ({ ubicacionId, conteoId: `c-${ubicacionId}`, abiertoEn: '2026-11-12T10:00:00.000Z' });
const SIN: Conteos = [];
const UBICS = ['tienda', 'deposito-1', 'deposito-2'];
const P = { stockTotal: 12, bajoMinimo: true, existencias: { tienda: 5, 'deposito-1': 7 }, disponible: true };

describe('puedeVerExistencias', () => {
  it('adm siempre ve; caj y sup solo las ubicaciones sin conteo abierto', () => {
    const conteos = [c('tienda'), c('deposito-2')];
    for (const u of UBICS) expect(puedeVerExistencias('adm', u, conteos)).toBe(true);
    for (const r of ['caj', 'sup'] as const) {
      expect(puedeVerExistencias(r, 'tienda', conteos)).toBe(false);
      expect(puedeVerExistencias(r, 'deposito-2', conteos)).toBe(false);
      expect(puedeVerExistencias(r, 'deposito-1', conteos)).toBe(true);
      expect(puedeVerExistencias(r, 'tienda', SIN)).toBe(true);
    }
    expect(puedeVerExistencias(undefined, 'tienda', conteos)).toBe(false);
  });
  it('marca solo cuando hay conteo y no es adm', () => {
    expect(marcaOcultamiento('caj', SIN)).toBeUndefined();
    expect(marcaOcultamiento('adm', [c('tienda')])).toBeUndefined();
    expect(marcaOcultamiento('sup', [c('tienda')])).toEqual({ existenciasOcultas: true, conteosAbiertos: [c('tienda')] });
    expect(hayOcultamiento('caj', [c('deposito-1')])).toBe(true);
  });
});

describe('proyectarProducto', () => {
  it.each(ROLES)('sin conteo abierto (%s): todo se entrega igual', (rol) => {
    expect(proyectarProducto(rol, SIN, P, UBICS)).toEqual(P);
  });
  it('adm con conteos abiertos ve todo', () => {
    expect(proyectarProducto('adm', [c('tienda'), c('deposito-1')], P, UBICS)).toEqual(P);
  });
  it.each(['caj', 'sup'] as const)('%s con la tienda en conteo: oculta tienda, total, bajo mínimo y disponible; deja el depósito', (rol) => {
    const r = proyectarProducto(rol, [c('tienda')], P, UBICS);
    expect(r).toEqual({ stockTotal: null, bajoMinimo: null, existencias: { 'deposito-1': 7, tienda: null, }, disponible: null });
    expect(JSON.stringify(r)).not.toContain('"tienda":5');
    expect(JSON.stringify(r)).not.toMatch(/\b12\b/);
  });
  it('un depósito en conteo: oculta ese depósito, el total y bajo mínimo, pero «disponible» se conserva (la tienda no está en conteo)', () => {
    const r = proyectarProducto('sup', [c('deposito-1')], P, UBICS);
    expect(r.existencias).toEqual({ tienda: 5, 'deposito-1': null });
    expect(r.stockTotal).toBeNull();
    expect(r.bajoMinimo).toBeNull();
    expect(r.disponible).toBe(true);
  });
  it('varios conteos abiertos ocultan cada ubicación', () => {
    const r = proyectarProducto('caj', [c('tienda'), c('deposito-1'), c('deposito-2')], P, UBICS);
    expect(r.existencias).toEqual({ tienda: null, 'deposito-1': null, 'deposito-2': null });
  });
  it('un producto que no controla stock (sin stockTotal) no cambia: ausente sigue significando «no controla»', () => {
    const sinControl = { bajoMinimo: false, existencias: {}, disponible: true };
    const r = proyectarProducto('caj', [c('tienda')], sinControl, UBICS);
    expect(r).toEqual(sinControl);
    expect('stockTotal' in r).toBe(false);
  });
});

describe('series, movimientos y faltantes', () => {
  const unidades = [
    { serie: 'a', estado: 'disponible', ubicacionId: 'tienda' },
    { serie: 'b', estado: 'disponible', ubicacionId: 'deposito-1' },
    { serie: 'c', estado: 'vendida', ubicacionId: 'tienda' },
  ];
  it('caj/sup no reciben las disponibles de la ubicación en conteo; adm y sin conteo, todas', () => {
    expect(filtrarUnidadesLista('caj', [c('tienda')], unidades).map((u) => u.serie)).toEqual(['b', 'c']);
    expect(filtrarUnidadesLista('adm', [c('tienda')], unidades)).toHaveLength(3);
    expect(filtrarUnidadesLista('sup', SIN, unidades)).toHaveLength(3);
  });
  const mov = { productoId: 'p', ubicacionId: 'tienda', delta: -1, saldoUbicacion: 4, saldoTotal: 11, tipo: 'venta' };
  it('movimientos: sup sin saldos si la ubicación está en conteo; con otra ubicación en conteo solo pierde saldoTotal', () => {
    expect(proyectarMovimiento('sup', [c('tienda')], mov)).toEqual({ productoId: 'p', ubicacionId: 'tienda', delta: -1, tipo: 'venta' });
    expect(proyectarMovimiento('sup', [c('deposito-1')], mov)).toEqual({ productoId: 'p', ubicacionId: 'tienda', delta: -1, tipo: 'venta', saldoUbicacion: 4 });
    expect(proyectarMovimiento('adm', [c('tienda')], mov)).toEqual(mov);
    expect(proyectarMovimiento('sup', SIN, mov)).toEqual(mov);
  });
  it('recortarFaltantes quita `disponible` solo en la ubicación en conteo y solo a quien no es adm', () => {
    const f: Faltante[] = [
      { productoId: 'p', almacenId: 'tienda', pedido: 3, disponible: 1 },
      { productoId: 'q', almacenId: 'deposito-1', pedido: 2, disponible: 0 },
    ];
    expect(recortarFaltantes('caj', [c('tienda')], f)).toEqual([{ productoId: 'p', almacenId: 'tienda', pedido: 3 }, f[1]]);
    expect(recortarFaltantes('adm', [c('tienda')], f)).toEqual(f);
    expect(recortarFaltantes('sup', SIN, f)).toEqual(f);
  });
});

describe('conteos abiertos desde las ubicaciones reales (apertura y cierre)', () => {
  let db: DobleDb;
  const leer = (): Conteos => {
    const ubic = UBICS.map((id) => ({ id, data: (db.dato(`tenants/${T}/ubicaciones/${id}`) ?? {}) as Record<string, unknown> }));
    const conteos = new Map(ubic.flatMap((u) => (typeof u.data['conteoAbiertoId'] === 'string' ? [[u.data['conteoAbiertoId'], (db.dato(`tenants/${T}/conteos/${u.data['conteoAbiertoId']}`) ?? {}) as Record<string, unknown>] as const] : [])));
    return conteosAbiertosDe(ubic, conteos);
  };
  beforeEach(async () => {
    db = await nuevoEntorno();
    await altaProducto(db, producto('lapiz'));
    await cargar(db, 'lapiz', 'tienda', 5);
  });
  it('abrir oculta, varios conteos se suman, cerrar restituye la vista', async () => {
    expect(leer()).toEqual([]);
    expect(puedeVerExistencias('caj', 'tienda', leer())).toBe(true);
    await db.runTransaction((tx) => abrirConteo(tx, { tenantId: T, operacionId: op('a1'), por: SUP, conteoId: 'ct1', ubicacionId: 'tienda' }));
    await db.runTransaction((tx) => abrirConteo(tx, { tenantId: T, operacionId: op('a2'), por: ADM, conteoId: 'ct2', ubicacionId: 'deposito-1' }));
    const linea = (conteoId: string, contado: number) =>
      db.runTransaction((tx) => registrarLineaConteo(tx, { tenantId: T, operacionId: op('l'), por: SUP, conteoId, productoId: 'lapiz', contado }));
    await linea('ct1', 5);
    await linea('ct2', 0);
    const abiertos = leer();
    expect(abiertos.map((x) => [x.ubicacionId, x.conteoId])).toEqual([['deposito-1', 'ct2'], ['tienda', 'ct1']]);
    expect(typeof abiertos[0]?.abiertoEn).toBe('string'); // el doble guarda la marca del servidor como texto; Firestore real guarda un Timestamp (ISO)
    expect(puedeVerExistencias('sup', 'tienda', abiertos)).toBe(false);
    expect(puedeVerExistencias('sup', 'deposito-2', abiertos)).toBe(true);
    expect(proyectarProducto('caj', abiertos, P, UBICS).existencias['tienda']).toBeNull();
    await db.runTransaction((tx) => cerrarConteo(tx, { tenantId: T, operacionId: op('c1'), por: SUP, conteoId: 'ct1', productosConExistencia: ['lapiz'] }));
    const resto = leer();
    expect(resto.map((x) => x.ubicacionId)).toEqual(['deposito-1']);
    expect(proyectarProducto('caj', resto, P, UBICS).existencias['tienda']).toBe(5);
    await db.runTransaction((tx) => cerrarConteo(tx, { tenantId: T, operacionId: op('c2'), por: SUP, conteoId: 'ct2', productosConExistencia: [] }));
    expect(leer()).toEqual([]);
    expect(proyectarProducto('caj', leer(), P, UBICS)).toEqual(P);
  });
  it('falla cerrado: sin documento del conteo igual se oculta (abiertoEn nulo)', () => {
    expect(conteosAbiertosDe([{ id: 'tienda', data: { conteoAbiertoId: 'x' } }], new Map())).toEqual([{ ubicacionId: 'tienda', conteoId: 'x', abiertoEn: null }]);
  });
});

describe('StockInsuficiente lleva la ubicación', () => {
  it('cada faltante trae almacenId para que el coordinador decida el recorte', () => {
    const e = new StockInsuficiente([{ productoId: 'p', almacenId: 'tienda', pedido: 2, disponible: 1 }]);
    expect(e.faltantes[0]?.almacenId).toBe('tienda');
    expect(e.message).not.toMatch(/\b1\b/);
  });
});
