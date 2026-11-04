import { validarEvento } from '@novutienda/nucleo';
import { abrirTurno, aprobarAnulacion, confirmarVenta, registrarMovimientoCaja, solicitarAnulacion } from '@novutienda/pos';
import type { Recibo } from '@novutienda/recibos';
import { beforeEach, describe, expect, it } from 'vitest';
import { T, UUID, caj, contar, doc, entornoListo, eventosDe, sup, type Entorno } from './entorno.js';
import { verificarInvariantes } from './invariantes.js';

const TURNO = UUID(900);
let e: Entorno;

const vender = (n: number, cantidad = 1) =>
  confirmarVenta(e.deps, T, caj, UUID(n), { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'lapiz', cantidad }] }, [
    { medio: 'efectivo', moneda: 'BOB', monto: 7000 * cantidad },
  ]);

beforeEach(async () => {
  e = await entornoListo();
  await abrirTurno(e.deps, T, caj, TURNO, { BOB: 0 });
});

describe('bandeja en memoria: entrega duplicada y desordenada', () => {
  it('venta.confirmada repetida 3 veces y barajada genera un solo recibo por venta, sin saltos', async () => {
    for (const n of [1, 2, 3, 4]) await vender(n);
    const r = await e.bandeja.entregar(T, { duplicados: 2, orden: 'barajado', semilla: 7 });
    expect(r.fallidas).toEqual([]);
    expect(contar(e, T, 'recibos')).toBe(4);
    const numeros = e.db.coleccion(`tenants/${T}/recibos`).map((x) => (x.datos as unknown as Recibo).numero).sort();
    expect(numeros).toEqual(['A-000001', 'A-000002', 'A-000003', 'A-000004']);
    expect(eventosDe(e, T, 'recibo.emitido')).toHaveLength(4);
    expect(doc(e, T, 'contadores/recibo_A')).toMatchObject({ ultimo: 4 });
    expect(doc(e, T, 'contadores_recibo/A')).toBeUndefined();
  });

  it('venta.anulada antes que venta.confirmada: Recibos la guarda pendiente y emite el recibo ANULADO', async () => {
    await vender(1);
    await registrarMovimientoCaja(e.deps, T, caj, UUID(60), { tipo: 'ingreso', moneda: 'BOB', monto: 7000, motivo: 'fondo' });
    await solicitarAnulacion(e.deps, T, caj, UUID(1), 'error');
    await aprobarAnulacion(e.deps, T, sup, UUID(1));
    // Se entrega al revés y duplicado: primero la anulación, que aún no tiene comprobante.
    const r = await e.bandeja.entregar(T, { orden: 'inverso', duplicados: 1 });
    expect(r.fallidas).toEqual([]);
    expect(doc(e, T, `recibos/recibo-${UUID(1)}`)).toMatchObject({ estado: 'ANULADO', numero: 'A-000001' });
    expect(doc(e, T, 'productos/lapiz')?.['stockTotal']).toBe(15);
    verificarInvariantes(e, T);
  });

  it('el bus real también duplica los eventos de stock: nadie los consume y no pasa nada', async () => {
    await vender(1);
    expect(eventosDe(e, T, 'stock.cambiado').length).toBeGreaterThan(0);
    const r = await e.bandeja.entregar(T, { duplicados: 3 });
    expect(r.fallidas).toEqual([]);
  });

  it('I-01 corregida: con entrega desordenada el recibo lleva el mismo número que la venta', async () => {
    await vender(1);
    await vender(2);
    await e.bandeja.entregar(T, { orden: 'inverso' });
    const recibo = (n: number): string => (doc(e, T, `recibos/recibo-${UUID(n)}`) as unknown as Recibo).numero;
    const receiptNo = (n: number): number => (doc(e, T, `ventas/${UUID(n)}`) as unknown as { receiptNo: number }).receiptNo;
    // El POS numera en la transacción de la venta; Recibos usa el número del evento, llegue en el orden que llegue.
    expect([receiptNo(1), receiptNo(2)]).toEqual([1, 2]);
    expect([recibo(1), recibo(2)]).toEqual(['A-000001', 'A-000002']);
  });

  it('todo lo publicado por los módulos cumple su contrato v1', async () => {
    await vender(1);
    await e.bandeja.entregar(T);
    const publicados = await e.bandeja.publicados(T);
    expect(publicados.length).toBeGreaterThan(3);
    for (const ev of publicados) expect(validarEvento(ev), `${ev.tipo} ${ev.id}`).toMatchObject({ ok: true });
  });
});
