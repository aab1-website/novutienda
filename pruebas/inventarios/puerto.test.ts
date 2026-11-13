import { beforeEach, describe, expect, it } from 'vitest';
import {
  aplicarReversion,
  aplicarSalida,
  EntradaInvalida,
  OperacionConflicto,
  prepararReversion,
  prepararSalida,
  ProductoInactivo,
  SerieNoDisponible,
  StockInsuficiente,
  actualizarProducto,
  ajustar,
  type LineaSalida,
} from './api.js';
import type { DobleDb } from './doble-db.js';
import { ADM, altaProducto, cargar, CAJ, contar, doc, nuevoEntorno, op, producto, T, verificarInvariantes } from './entorno.js';

let db: DobleDb;

async function vender(id: string, lineas: LineaSalida[], tipo: 'venta' | 'pedido' = 'venta'): Promise<void> {
  await db.runTransaction(async (tx) => {
    const plan = await prepararSalida(tx, T, lineas);
    aplicarSalida(tx, plan, { tipo, id }, CAJ);
  });
}

async function revertir(id: string, tipo: 'venta' | 'pedido' = 'venta'): Promise<void> {
  await db.runTransaction(async (tx) => {
    const plan = await prepararReversion(tx, T, { tipo, id });
    aplicarReversion(tx, plan, { tipo, id }, ADM);
  });
}

beforeEach(async () => {
  db = await nuevoEntorno();
  await altaProducto(db, producto('lapiz', { minimo: 5 }));
  await altaProducto(db, producto('celular', { conSerie: true, garantiaMeses: 12 }));
  await cargar(db, 'lapiz', 'tienda', 10);
  await cargar(db, 'lapiz', 'deposito-1', 4);
  await cargar(db, 'celular', 'tienda', 3, ['S1', 'S2', 'S3']);
  verificarInvariantes(db);
});

describe('puerto: salida', () => {
  it('descuenta stock, escribe movimiento, existencia pública, operación, eventos y auditoría', async () => {
    await vender('v1', [{ productoId: 'lapiz', cantidad: 3, almacenId: 'tienda' }]);
    expect(doc(db, 'existencias', 'lapiz__tienda')?.['cantidad']).toBe(7);
    expect(doc(db, 'productos', 'lapiz')?.['stockTotal']).toBe(11);
    const mov = doc(db, 'movimientos', 'venta-v1__lapiz__tienda');
    expect(mov).toMatchObject({ tipo: 'venta', delta: -3, saldoUbicacion: 7, saldoTotal: 11, por: 'u-caj', rol: 'caj' });
    expect(doc(db, 'operaciones', 'venta-v1')?.['tipo']).toBe('salida');
    expect(doc(db, 'eventos', 'sc-venta-v1__lapiz__tienda')).toMatchObject({ tipo: 'stock.cambiado', datos: { delta: -3, saldo: 7, motivo: 'venta' } });
    expect(contar(db, 'auditoria')).toBeGreaterThan(0);
    verificarInvariantes(db);
  });

  it('publica stock.bajo solo al cruzar el mínimo', async () => {
    await vender('v1', [{ productoId: 'lapiz', cantidad: 8, almacenId: 'tienda' }]); // 14 -> 6
    expect(doc(db, 'eventos', 'sb-venta-v1__lapiz')).toBeUndefined();
    await vender('v2', [{ productoId: 'lapiz', cantidad: 2, almacenId: 'tienda' }]); // 6 -> 4
    expect(doc(db, 'eventos', 'sb-venta-v2__lapiz')).toMatchObject({ tipo: 'stock.bajo', datos: { saldoTotal: 4, minimo: 5 } });
    expect(doc(db, 'productos', 'lapiz')?.['bajoMinimo']).toBe(true);
    await vender('v3', [{ productoId: 'lapiz', cantidad: 1, almacenId: 'deposito-1' }]); // ya estaba bajo
    expect(doc(db, 'eventos', 'sb-venta-v3__lapiz')).toBeUndefined();
    verificarInvariantes(db);
  });

  it('sin stock falla con todos los faltantes y no escribe nada', async () => {
    const antes = db.docs.size;
    const error = await vender('v1', [
      { productoId: 'lapiz', cantidad: 11, almacenId: 'tienda' },
      { productoId: 'lapiz', cantidad: 5, almacenId: 'deposito-1' },
    ]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StockInsuficiente);
    expect((error as StockInsuficiente).faltantes).toHaveLength(2);
    expect((error as StockInsuficiente).codigo).toBe('failed-precondition');
    expect(db.docs.size).toBe(antes);
    verificarInvariantes(db);
  });

  it('vender del depósito descuenta de ese almacén', async () => {
    await vender('v1', [{ productoId: 'lapiz', cantidad: 4, almacenId: 'deposito-1' }]);
    expect(doc(db, 'existencias', 'lapiz__deposito-1')?.['cantidad']).toBe(0);
    verificarInvariantes(db);
  });

  it('con serie: la unidad pasa a vendida con ventaRef y garantiaHasta', async () => {
    await vender('v1', [{ productoId: 'celular', cantidad: 1, almacenId: 'tienda', series: ['S2'] }]);
    expect(doc(db, 'unidades', 'celular__S2')).toMatchObject({ estado: 'vendida', ventaRef: { tipo: 'venta', id: 'v1' }, garantiaHasta: '2027-11-04' });
    expect(doc(db, 'existencias', 'celular__tienda')?.['series']).toEqual(['S1', 'S3']);
    verificarInvariantes(db);
  });

  it('la misma serie dos veces: la segunda falla', async () => {
    await vender('v1', [{ productoId: 'celular', cantidad: 1, almacenId: 'tienda', series: ['S1'] }]);
    await expect(vender('v2', [{ productoId: 'celular', cantidad: 1, almacenId: 'tienda', series: ['S1'] }])).rejects.toBeInstanceOf(SerieNoDisponible);
    verificarInvariantes(db);
  });

  it('dos ventas concurrentes de la misma serie: una gana', async () => {
    const r = await Promise.allSettled([
      vender('va', [{ productoId: 'celular', cantidad: 1, almacenId: 'tienda', series: ['S3'] }]),
      vender('vb', [{ productoId: 'celular', cantidad: 1, almacenId: 'tienda', series: ['S3'] }]),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const perdedora = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(perdedora.reason).toBeInstanceOf(SerieNoDisponible);
    expect(db.reintentos).toBeGreaterThan(0);
    verificarInvariantes(db);
  });

  it('serie de otro almacén (SerieNoDisponible, no StockInsuficiente: no revela el stock), inexistente o con cantidad distinta se rechaza', async () => {
    await expect(vender('v1', [{ productoId: 'celular', cantidad: 1, almacenId: 'deposito-1', series: ['S1'] }])).rejects.toBeInstanceOf(SerieNoDisponible);
    await expect(vender('v2', [{ productoId: 'celular', cantidad: 1, almacenId: 'tienda', series: ['NOEXISTE'] }])).rejects.toBeInstanceOf(SerieNoDisponible);
    await expect(vender('v3', [{ productoId: 'celular', cantidad: 2, almacenId: 'tienda', series: ['S1'] }])).rejects.toBeInstanceOf(EntradaInvalida);
    await expect(vender('v4', [{ productoId: 'celular', cantidad: 1, almacenId: 'tienda', series: [] }])).rejects.toBeInstanceOf(EntradaInvalida);
    await expect(vender('v5', [{ productoId: 'lapiz', cantidad: 1, almacenId: 'tienda', series: ['X'] }])).rejects.toBeInstanceOf(EntradaInvalida);
  });

  it('producto inactivo o inexistente', async () => {
    await db.runTransaction((tx) => actualizarProducto(tx, { tenantId: T, operacionId: op(), por: ADM, productoId: 'lapiz', cambios: { activo: false } }));
    await expect(vender('v1', [{ productoId: 'lapiz', cantidad: 1, almacenId: 'tienda' }])).rejects.toBeInstanceOf(ProductoInactivo);
    await expect(vender('v2', [{ productoId: 'fantasma', cantidad: 1, almacenId: 'tienda' }])).rejects.toBeInstanceOf(ProductoInactivo);
  });

  it('ids y cantidades que no cumplen se rechazan sin corregir', async () => {
    const malas: LineaSalida[] = [
      { productoId: 'Lapiz', cantidad: 1, almacenId: 'tienda' },
      { productoId: ' lapiz', cantidad: 1, almacenId: 'tienda' },
      { productoId: 'lapiz', cantidad: 0, almacenId: 'tienda' },
      { productoId: 'lapiz', cantidad: 1.5, almacenId: 'tienda' },
      { productoId: 'lapiz', cantidad: 1, almacenId: 'Tienda' },
      { productoId: 'lapiz', cantidad: 1, almacenId: 'deposito-3' },
      { productoId: 'a', cantidad: 1, almacenId: 'tienda' },
      { productoId: 'x'.repeat(61), cantidad: 1, almacenId: 'tienda' },
    ];
    for (const l of malas) await expect(vender('v1', [l])).rejects.toBeInstanceOf(EntradaInvalida);
    await expect(vender('v1', [])).rejects.toBeInstanceOf(EntradaInvalida);
    const cincuentaYUna = Array.from({ length: 51 }, () => ({ productoId: 'lapiz', cantidad: 1, almacenId: 'tienda' }));
    await expect(vender('v1', cincuentaYUna)).rejects.toBeInstanceOf(EntradaInvalida);
    await expect(db.runTransaction((tx) => prepararSalida(tx, 'T/../x', [{ productoId: 'lapiz', cantidad: 1, almacenId: 'tienda' }]))).rejects.toBeInstanceOf(EntradaInvalida);
    await expect(db.runTransaction(async (tx) => { const p = await prepararSalida(tx, T, [{ productoId: 'lapiz', cantidad: 1, almacenId: 'tienda' }]); aplicarSalida(tx, p, { tipo: 'venta', id: 'a/b' }, CAJ); })).rejects.toBeInstanceOf(EntradaInvalida);
  });

  it('líneas repetidas del mismo producto y almacén se fusionan en un solo movimiento', async () => {
    await vender('v1', [
      { productoId: 'lapiz', cantidad: 2, almacenId: 'tienda' },
      { productoId: 'lapiz', cantidad: 3, almacenId: 'tienda' },
    ]);
    expect(doc(db, 'movimientos', 'venta-v1__lapiz__tienda')?.['delta']).toBe(-5);
    verificarInvariantes(db);
  });

  it('producto sin stockTotal no controla stock: no se mueve ni se registra', async () => {
    await altaProducto(db, producto('servicio', { controlaStock: false }));
    await vender('v1', [{ productoId: 'servicio', cantidad: 99, almacenId: 'tienda' }]);
    expect(doc(db, 'movimientos', 'venta-v1__servicio__tienda')).toBeUndefined();
    expect(doc(db, 'operaciones', 'venta-v1')).toBeDefined();
    verificarInvariantes(db);
  });

  it('repetir la misma venta (misma referencia) no duplica: la transacción falla por create', async () => {
    await vender('v1', [{ productoId: 'lapiz', cantidad: 1, almacenId: 'tienda' }]);
    await expect(vender('v1', [{ productoId: 'lapiz', cantidad: 1, almacenId: 'tienda' }])).rejects.toThrow(/ALREADY_EXISTS/);
    expect(doc(db, 'existencias', 'lapiz__tienda')?.['cantidad']).toBe(9);
    verificarInvariantes(db);
  });

  it('un ajuste con otro contenido bajo la misma operacionId es conflicto', async () => {
    const id = op('aj');
    const hacer = (delta: number) => db.runTransaction((tx) => ajustar(tx, { tenantId: T, operacionId: id, por: ADM, motivo: 'conteo', lineas: [{ productoId: 'lapiz', ubicacionId: 'tienda', delta }] }));
    await hacer(1);
    await expect(hacer(2)).rejects.toBeInstanceOf(OperacionConflicto);
  });
});

describe('puerto: reversión', () => {
  it('devuelve stock y series, y es idempotente', async () => {
    await vender('v1', [
      { productoId: 'lapiz', cantidad: 2, almacenId: 'tienda' },
      { productoId: 'celular', cantidad: 2, almacenId: 'tienda', series: ['S1', 'S3'] },
    ]);
    await revertir('v1');
    expect(doc(db, 'existencias', 'lapiz__tienda')?.['cantidad']).toBe(10);
    expect(doc(db, 'unidades', 'celular__S1')).toMatchObject({ estado: 'disponible' });
    expect(doc(db, 'unidades', 'celular__S1')?.['ventaRef']).toBeUndefined();
    expect(doc(db, 'unidades', 'celular__S1')?.['garantiaHasta']).toBeUndefined();
    expect(doc(db, 'movimientos', 'venta-anula-v1__lapiz__tienda')).toMatchObject({ tipo: 'anulacion', delta: 2 });
    verificarInvariantes(db);
    const antes = db.docs.size;
    await revertir('v1'); // repetida: no escribe
    expect(db.docs.size).toBe(antes);
    verificarInvariantes(db);
  });

  it('sin salida registrada falla', async () => {
    await expect(revertir('nunca')).rejects.toThrow(/No hay salida/);
  });

  it('una serie vuelve a venderse tras la reversión', async () => {
    await vender('v1', [{ productoId: 'celular', cantidad: 1, almacenId: 'tienda', series: ['S1'] }]);
    await revertir('v1');
    await vender('v2', [{ productoId: 'celular', cantidad: 1, almacenId: 'tienda', series: ['S1'] }]);
    expect(doc(db, 'unidades', 'celular__S1')).toMatchObject({ estado: 'vendida', ventaRef: { id: 'v2' } });
    verificarInvariantes(db);
  });
});
