import { abrirTurno, aprobarAnulacion, confirmarVenta, registrarMovimientoCaja, solicitarAnulacion } from '@novutienda/pos';
import type { Recibo } from '@novutienda/recibos';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  T, T2, UUID, altaProducto, cargarStock, caj, catalogoEstandar, contar, doc, entornoListo, eventosDe, prepararTenant, producto, sup, type Entorno,
} from './entorno.js';
import { verificarInvariantes } from './invariantes.js';

let e: Entorno;
const vender = (tenantId: string, ventaId: string, cantidad = 1) =>
  confirmarVenta(e.deps, tenantId, caj, ventaId, { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'lapiz', cantidad }] }, [
    { medio: 'efectivo', moneda: 'BOB', monto: 7000 * cantidad },
  ]);

beforeEach(async () => {
  e = await entornoListo(T);
  await prepararTenant(e, T2);
  await catalogoEstandar(e, T2);
});

describe('aislamiento entre dos tenants en la misma base', () => {
  it('cada tenant tiene su turno, su stock, su contador de recibos y sus eventos', async () => {
    // Un turno abierto por tenant a la vez (1 caja activa POR tenant) y el MISMO id de venta en ambos.
    await abrirTurno(e.deps, T, caj, UUID(900), { BOB: 0 });
    await abrirTurno(e.deps, T2, caj, UUID(900), { BOB: 0 });
    await vender(T, UUID(1), 2);
    await vender(T2, UUID(1), 1);
    expect(doc(e, T, 'existencias/lapiz__tienda')?.['cantidad']).toBe(8);
    expect(doc(e, T2, 'existencias/lapiz__tienda')?.['cantidad']).toBe(9);
    expect(doc(e, T, `ventas/${UUID(1)}`)).toMatchObject({ total: 14000, receiptNo: 1 });
    expect(doc(e, T2, `ventas/${UUID(1)}`)).toMatchObject({ total: 7000, receiptNo: 1 });
    verificarInvariantes(e, T);
    verificarInvariantes(e, T2);
  });

  it('entregar los eventos de un tenant no genera recibos ni mueve stock en el otro', async () => {
    await abrirTurno(e.deps, T, caj, UUID(900), { BOB: 0 });
    await abrirTurno(e.deps, T2, caj, UUID(900), { BOB: 0 });
    await vender(T, UUID(1));
    await vender(T, UUID(2));
    await vender(T2, UUID(1));
    await e.bandeja.entregar(T, { duplicados: 1 });
    expect(contar(e, T, 'recibos')).toBe(2);
    expect(contar(e, T2, 'recibos')).toBe(0);
    await e.bandeja.entregar(T2);
    expect(contar(e, T2, 'recibos')).toBe(1);
    expect((doc(e, T2, `recibos/recibo-${UUID(1)}`) as unknown as Recibo).numero).toBe('A-000001');
    expect(e.db.coleccion(`tenants/${T}/recibos`).map((r) => (r.datos as unknown as Recibo).numero).sort()).toEqual(['A-000001', 'A-000002']);
    expect(eventosDe(e, T2, 'recibo.emitido')).toHaveLength(1);
  });

  it('un producto de otro tenant no existe para el POS ni consume su stock', async () => {
    await abrirTurno(e.deps, T, caj, UUID(900), { BOB: 0 });
    await altaProducto(e, T2, producto('solo-b'));
    await cargarStock(e, T2, 'solo-b', 'tienda', 3);
    await expect(
      confirmarVenta(e.deps, T, caj, UUID(1), { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'solo-b', cantidad: 1 }] }, [
        { medio: 'efectivo', moneda: 'BOB', monto: 7000 },
      ]),
    ).rejects.toMatchObject({ codigo: 'producto-inexistente' });
    expect(doc(e, T2, 'existencias/solo-b__tienda')?.['cantidad']).toBe(3);
  });

  it('una venta de un tenant se rechaza si el turno abierto está en el otro', async () => {
    await abrirTurno(e.deps, T2, caj, UUID(900), { BOB: 0 });
    await expect(vender(T, UUID(1))).rejects.toMatchObject({ codigo: 'sin-turno' });
  });

  it('la anulación en un tenant no revierte el stock ni toca los recibos del otro', async () => {
    await abrirTurno(e.deps, T, caj, UUID(900), { BOB: 0 });
    await abrirTurno(e.deps, T2, caj, UUID(900), { BOB: 0 });
    await vender(T, UUID(1));
    await vender(T2, UUID(1));
    await e.bandeja.entregar(T);
    await e.bandeja.entregar(T2);
    await registrarMovimientoCaja(e.deps, T, caj, UUID(60), { tipo: 'ingreso', moneda: 'BOB', monto: 1, motivo: 'm' });
    await solicitarAnulacion(e.deps, T, caj, UUID(1), 'error');
    await aprobarAnulacion(e.deps, T, sup, UUID(1));
    await e.bandeja.entregar(T);
    await e.bandeja.entregar(T2);
    expect(doc(e, T, `recibos/recibo-${UUID(1)}`)?.['estado']).toBe('ANULADO');
    expect(doc(e, T2, `recibos/recibo-${UUID(1)}`)?.['estado']).toBe('EMITIDO');
    expect(doc(e, T, 'existencias/lapiz__tienda')?.['cantidad']).toBe(10);
    expect(doc(e, T2, 'existencias/lapiz__tienda')?.['cantidad']).toBe(9);
    verificarInvariantes(e, T);
    verificarInvariantes(e, T2);
  });
});
