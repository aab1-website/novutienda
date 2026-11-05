import { beforeEach, describe, expect, it } from 'vitest';
import {
  actualizarProducto,
  ajustar,
  crearProducto,
  crearUbicacion,
  EntradaInvalida,
  EstadoInvalido,
  ingresar,
  OperacionConflicto,
  SerieNoDisponible,
  SinPermiso,
  StockInsuficiente,
  traspasar,
} from './api.js';
import { LimiteDelPlan } from '@novutienda/nucleo';
import type { DobleDb } from './doble-db.js';
import { ADM, altaProducto, CAJ, cargar, contar, doc, nuevoEntorno, op, producto, SUP, T, verificarInvariantes } from './entorno.js';

let db: DobleDb;

beforeEach(async () => {
  db = await nuevoEntorno();
  await altaProducto(db, producto('lapiz', { minimo: 5 }));
  await altaProducto(db, producto('celular', { conSerie: true, garantiaMeses: 12 }));
  verificarInvariantes(db);
});

const ing = (operacionId: string, cantidad: number, extra: Partial<Parameters<typeof ingresar>[1]> = {}) =>
  db.runTransaction((tx) =>
    ingresar(tx, { tenantId: T, operacionId, por: SUP, ubicacionId: 'tienda', lineas: [{ productoId: 'lapiz', cantidad }], ...extra }),
  );

describe('ingreso', () => {
  it('suma stock, crea movimiento y eventos', async () => {
    await ing('i1', 7);
    expect(doc(db, 'existencias', 'lapiz__tienda')?.['cantidad']).toBe(7);
    expect(doc(db, 'movimientos', 'i1__lapiz__tienda')).toMatchObject({ tipo: 'ingreso', delta: 7, saldoTotal: 7 });
    expect(doc(db, 'eventos', 'sc-i1__lapiz__tienda')).toBeDefined();
    verificarInvariantes(db);
  });

  it('misma operacionId dos veces = un solo movimiento', async () => {
    const a = await ing('i1', 7);
    const b = await ing('i1', 7);
    expect(a.repetida).toBe(false);
    expect(b.repetida).toBe(true);
    expect(doc(db, 'productos', 'lapiz')?.['stockTotal']).toBe(7);
    expect(contar(db, 'movimientos')).toBe(1);
    verificarInvariantes(db);
  });

  it('misma operacionId con otro contenido = already-exists', async () => {
    await ing('i1', 7);
    const error = await ing('i1', 8).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OperacionConflicto);
    expect((error as OperacionConflicto).codigo).toBe('already-exists');
    expect(doc(db, 'productos', 'lapiz')?.['stockTotal']).toBe(7);
  });

  it('reintentos concurrentes de la misma operación escriben una sola vez', async () => {
    await Promise.all([ing('i1', 3), ing('i1', 3), ing('i1', 3)]);
    expect(doc(db, 'productos', 'lapiz')?.['stockTotal']).toBe(3);
    expect(contar(db, 'movimientos')).toBe(1);
    verificarInvariantes(db);
  });

  it('crea unidades con serie y rechaza series repetidas o ya registradas', async () => {
    await cargar(db, 'celular', 'tienda', 2, ['A1', 'A2']);
    expect(doc(db, 'unidades', 'celular__A1')).toMatchObject({ estado: 'disponible', ubicacionId: 'tienda' });
    verificarInvariantes(db);
    await expect(cargar(db, 'celular', 'deposito-1', 1, ['A1'])).rejects.toThrow(/ya está registrada/);
    await expect(cargar(db, 'celular', 'tienda', 2, ['B1', 'B1'])).rejects.toBeInstanceOf(EntradaInvalida);
    await expect(cargar(db, 'celular', 'tienda', 2, ['B1'])).rejects.toBeInstanceOf(EntradaInvalida);
    await expect(cargar(db, 'celular', 'tienda', 1)).rejects.toBeInstanceOf(EntradaInvalida);
    await expect(cargar(db, 'lapiz', 'tienda', 1, ['Z1'])).rejects.toBeInstanceOf(EntradaInvalida);
    await expect(cargar(db, 'celular', 'tienda', 1, ['mala serie'])).rejects.toBeInstanceOf(EntradaInvalida);
    verificarInvariantes(db);
  });

  it('exige rol sup/adm y ubicación válida', async () => {
    await expect(ing('i1', 1, { por: CAJ })).rejects.toBeInstanceOf(SinPermiso);
    await expect(ing('i2', 1, { ubicacionId: 'deposito-9' })).rejects.toBeInstanceOf(EntradaInvalida);
    await expect(ing('i/3', 1)).rejects.toBeInstanceOf(EntradaInvalida);
    await expect(ing('i__4', 1)).rejects.toBeInstanceOf(EntradaInvalida);
  });

  it('no ingresa a un producto que no controla stock ni a uno inexistente', async () => {
    await altaProducto(db, producto('servicio', { controlaStock: false }));
    await expect(db.runTransaction((tx) => ingresar(tx, { tenantId: T, operacionId: op(), por: SUP, ubicacionId: 'tienda', lineas: [{ productoId: 'servicio', cantidad: 1 }] }))).rejects.toBeInstanceOf(EstadoInvalido);
    await expect(db.runTransaction((tx) => ingresar(tx, { tenantId: T, operacionId: op(), por: SUP, ubicacionId: 'tienda', lineas: [{ productoId: 'nadie', cantidad: 1 }] }))).rejects.toThrow(/inexistente/);
  });
});

describe('traspaso', () => {
  const tr = (operacionId: string, lineas: { productoId: string; cantidad: number; series?: string[] }[], o = 'tienda', d = 'deposito-1', por = SUP) =>
    db.runTransaction((tx) => traspasar(tx, { tenantId: T, operacionId, por, origenId: o, destinoId: d, lineas }));

  beforeEach(async () => {
    await cargar(db, 'lapiz', 'tienda', 10);
    await cargar(db, 'celular', 'tienda', 3, ['S1', 'S2', 'S3']);
  });

  it('mueve entre almacenes sin cambiar el total y registra usuario y fecha', async () => {
    await tr('t1', [{ productoId: 'lapiz', cantidad: 4 }]);
    expect(doc(db, 'existencias', 'lapiz__tienda')?.['cantidad']).toBe(6);
    expect(doc(db, 'existencias', 'lapiz__deposito-1')?.['cantidad']).toBe(4);
    expect(doc(db, 'productos', 'lapiz')?.['stockTotal']).toBe(10);
    expect(doc(db, 'traspasos', 't1')).toMatchObject({ origenId: 'tienda', destinoId: 'deposito-1', por: 'u-sup', fecha: 'MARCA' });
    expect(doc(db, 'movimientos', 't1__lapiz__tienda')).toMatchObject({ tipo: 'traspaso', delta: -4 });
    expect(doc(db, 'movimientos', 't1__lapiz__deposito-1')).toMatchObject({ tipo: 'traspaso', delta: 4 });
    verificarInvariantes(db);
  });

  it('con serie mueve las unidades', async () => {
    await tr('t1', [{ productoId: 'celular', cantidad: 2, series: ['S1', 'S2'] }], 'tienda', 'deposito-2');
    expect(doc(db, 'unidades', 'celular__S1')).toMatchObject({ estado: 'disponible', ubicacionId: 'deposito-2' });
    verificarInvariantes(db);
    await expect(tr('t2', [{ productoId: 'celular', cantidad: 1, series: ['S1'] }])).rejects.toBeInstanceOf(SerieNoDisponible);
  });

  it('origen igual a destino, sin stock y sin permiso se rechazan; idempotencia', async () => {
    await expect(tr('t1', [{ productoId: 'lapiz', cantidad: 1 }], 'tienda', 'tienda')).rejects.toBeInstanceOf(EntradaInvalida);
    await expect(tr('t1', [{ productoId: 'lapiz', cantidad: 11 }])).rejects.toBeInstanceOf(StockInsuficiente);
    await expect(tr('t1', [{ productoId: 'lapiz', cantidad: 1 }], 'tienda', 'deposito-1', CAJ)).rejects.toBeInstanceOf(SinPermiso);
    await tr('t3', [{ productoId: 'lapiz', cantidad: 2 }]);
    expect((await tr('t3', [{ productoId: 'lapiz', cantidad: 2 }])).repetida).toBe(true);
    await expect(tr('t3', [{ productoId: 'lapiz', cantidad: 3 }])).rejects.toBeInstanceOf(OperacionConflicto);
    expect(contar(db, 'traspasos')).toBe(1);
    verificarInvariantes(db);
  });
});

describe('ajuste', () => {
  beforeEach(async () => {
    await cargar(db, 'lapiz', 'tienda', 10);
    await cargar(db, 'celular', 'tienda', 1, ['S1']);
  });
  const aj = (operacionId: string, delta: number, o: { motivo?: string; por?: typeof ADM; productoId?: string } = {}) =>
    db.runTransaction((tx) =>
      ajustar(tx, {
        tenantId: T,
        operacionId,
        por: o.por ?? ADM,
        motivo: o.motivo ?? 'conteo físico',
        lineas: [{ productoId: o.productoId ?? 'lapiz', ubicacionId: 'tienda', delta }],
      }),
    );

  it('solo adm, con motivo, y queda en la auditoría con el motivo', async () => {
    await aj('a1', -2);
    expect(doc(db, 'existencias', 'lapiz__tienda')?.['cantidad']).toBe(8);
    expect(db.coleccion(`tenants/${T}/auditoria`).some((a) => a.datos['accion'] === 'inventarios.ajuste' && a.datos['motivo'] === 'conteo físico')).toBe(true);
    await expect(aj('a2', 1, { por: SUP })).rejects.toBeInstanceOf(SinPermiso);
    await expect(aj('a3', 1, { motivo: '   ' })).rejects.toBeInstanceOf(EntradaInvalida);
    await expect(aj('a4', 0)).rejects.toBeInstanceOf(EntradaInvalida);
    verificarInvariantes(db);
  });

  it('en un producto con serie se rechaza', async () => {
    await expect(aj('a5', 1, { productoId: 'celular' })).rejects.toBeInstanceOf(EntradaInvalida);
    verificarInvariantes(db);
  });

  it('nunca deja saldo negativo e idempotente', async () => {
    await expect(aj('a6', -11)).rejects.toBeInstanceOf(StockInsuficiente);
    await aj('a7', 5);
    expect((await aj('a7', 5)).repetida).toBe(true);
    expect(doc(db, 'productos', 'lapiz')?.['stockTotal']).toBe(15);
    verificarInvariantes(db);
  });
});

describe('productos y límites', () => {
  it('el producto 201 se rechaza (LimiteDelPlan)', async () => {
    // 2 productos ya creados en beforeEach: se completan 200 y el siguiente falla.
    for (let i = 3; i <= 200; i++) await altaProducto(db, producto(`prod-${String(i)}`));
    expect(contar(db, 'productos')).toBe(200);
    await expect(altaProducto(db, producto('prod-201'))).rejects.toBeInstanceOf(LimiteDelPlan);
    expect(contar(db, 'productos')).toBe(200);
  });

  it('el cuarto almacén se rechaza por el tope del plan y la ubicación debe ser una de las tres', async () => {
    const { DobleDb } = await import('./doble-db.js');
    const lleno = new DobleDb();
    lleno.poner(`tenants/${T}`, { plan: 'base', modulos: {}, zonaHoraria: 'America/La_Paz', monedas: ['BOB', 'USD', 'ARS'] });
    lleno.poner(`tenants/${T}/contadores/uso`, { almacenes: 3 });
    await expect(lleno.runTransaction((tx) => crearUbicacion(tx, { tenantId: T, operacionId: op(), por: ADM, ubicacionId: 'tienda', nombre: 'x' }))).rejects.toBeInstanceOf(LimiteDelPlan);
    await expect(db.runTransaction((tx) => crearUbicacion(tx, { tenantId: T, operacionId: op(), por: ADM, ubicacionId: 'deposito-3', nombre: 'x' }))).rejects.toBeInstanceOf(EntradaInvalida);
    await expect(db.runTransaction((tx) => crearUbicacion(tx, { tenantId: T, operacionId: op(), por: ADM, ubicacionId: 'tienda', nombre: 'x' }))).rejects.toBeInstanceOf(EstadoInvalido);
  });

  it('id inválido, sku repetido y producto duplicado se rechazan', async () => {
    for (const id of ['Mayus', 'a', '-guion', 'con espacio', 'con_guion', 'x'.repeat(61)]) {
      await expect(altaProducto(db, producto(id, { sku: `S-${id.length}` }))).rejects.toBeInstanceOf(EntradaInvalida);
    }
    await expect(altaProducto(db, producto('otro', { sku: 'SKU-lapiz' }))).rejects.toBeInstanceOf(EstadoInvalido);
    await expect(altaProducto(db, producto('lapiz', { sku: 'NUEVO' }))).rejects.toBeInstanceOf(EstadoInvalido);
    await expect(altaProducto(db, producto('serie-sin-stock', { conSerie: true, controlaStock: false }))).rejects.toBeInstanceOf(EntradaInvalida);
  });

  it('solo adm crea productos; costos aparte', async () => {
    await expect(db.runTransaction((tx) => crearProducto(tx, { tenantId: T, operacionId: op(), por: SUP, producto: producto('nuevo') }))).rejects.toBeInstanceOf(SinPermiso);
    await altaProducto(db, producto('con-costo', { costoUSD: 250 }));
    expect(doc(db, 'costos', 'con-costo')).toEqual({ costoUSD: 250 });
    expect(doc(db, 'productos', 'con-costo')?.['costoUSD']).toBeUndefined();
    expect(doc(db, 'skus', 'SKU-con-costo')).toEqual({ productoId: 'con-costo' });
  });

  it('conSerie es inmutable tras el primer movimiento', async () => {
    await altaProducto(db, producto('libre'));
    const cambiar = (productoId: string, conSerie: boolean) =>
      db.runTransaction((tx) => actualizarProducto(tx, { tenantId: T, operacionId: op(), por: ADM, productoId, cambios: { conSerie } }));
    await cambiar('libre', true); // aún sin movimientos
    await cambiar('libre', false);
    await cargar(db, 'libre', 'tienda', 1);
    await expect(cambiar('libre', true)).rejects.toBeInstanceOf(EstadoInvalido);
    await db.runTransaction((tx) => actualizarProducto(tx, { tenantId: T, operacionId: op(), por: ADM, productoId: 'libre', cambios: { minimo: 5 } }));
    expect(doc(db, 'productos', 'libre')?.['bajoMinimo']).toBe(true);
    verificarInvariantes(db);
  });
});
