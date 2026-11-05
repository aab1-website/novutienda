import { calcularFirma, confirmarPedidoFirmado } from '@novutienda/inventarios';
import type { DatosPedidoConfirmadoV1, SobreEvento } from '@novutienda/nucleo';
import { beforeEach, describe, expect, it } from 'vitest';
import { publicarEnBandeja } from '../../plataforma/adaptadores/index.js';
import { T, contar, cotizacionVigente, doc, entornoListo, type Entorno } from './entorno.js';
import { verificarInvariantes } from './invariantes.js';

const SECRETO = 'secreto-de-prueba';
let e: Entorno;

async function firmado(pedidoId: string, items: { productoId: string; cantidad: number }[]) {
  const cuerpo = JSON.stringify({ pedidoId, items, confirmadoEn: '2026-11-04T14:59:00Z' });
  const marcaTiempo = String(e.reloj.ahora);
  return confirmarPedidoFirmado(
    { db: e.db, secreto: SECRETO, ahora: () => e.reloj.ahora },
    { tenantId: T, marcaTiempo, firma: calcularFirma(SECRETO, marcaTiempo, cuerpo), cuerpo },
  );
}

beforeEach(async () => {
  e = await entornoListo();
});

describe('pedido de WhatsApp firmado', () => {
  it('confirma y descuenta siempre de tienda (la serie más antigua), aunque haya stock en depósitos', async () => {
    const r = await firmado('pd-1', [{ productoId: 'lapiz', cantidad: 3 }, { productoId: 'celular', cantidad: 1 }]);
    expect(r).toMatchObject({ estado: 200, cuerpo: { ok: true, operacionId: 'nc-pd-1', repetida: false } });
    expect(doc(e, T, 'existencias/lapiz__tienda')?.['cantidad']).toBe(7);
    expect(doc(e, T, 'existencias/lapiz__deposito-1')?.['cantidad']).toBe(5);
    expect(doc(e, T, 'unidades/celular__A')).toMatchObject({ estado: 'vendida', ventaRef: { tipo: 'pedido', id: 'pd-1' } });
    expect(doc(e, T, 'movimientos/nc-pd-1__lapiz__tienda')).toMatchObject({ tipo: 'pedido', delta: -3 });
    verificarInvariantes(e, T);
    // Reintento firmado de nuevo: misma respuesta, sin nuevo movimiento.
    const movimientos = contar(e, T, 'movimientos');
    expect(await firmado('pd-1', [{ productoId: 'celular', cantidad: 1 }, { productoId: 'lapiz', cantidad: 3 }])).toMatchObject({
      estado: 200, cuerpo: { repetida: true },
    });
    expect(contar(e, T, 'movimientos')).toBe(movimientos);
  });

  it('sin stock en tienda devuelve faltantes (409), no escribe operación y deja el stock intacto', async () => {
    // Hay 15 lápices en total, pero solo 10 en tienda: el depósito no cuenta.
    const movimientos = contar(e, T, 'movimientos');
    const r = await firmado('pd-2', [{ productoId: 'lapiz', cantidad: 12 }]);
    expect(r).toEqual({
      estado: 409,
      cuerpo: { ok: false, error: 'stock-insuficiente', faltantes: [{ productoId: 'lapiz', almacenId: 'tienda', pedido: 12, disponible: 10 }] },
    });
    expect(doc(e, T, 'operaciones/nc-pd-2')).toBeUndefined();
    expect(doc(e, T, 'existencias/lapiz__tienda')?.['cantidad']).toBe(10);
    expect(contar(e, T, 'movimientos')).toBe(movimientos);
    verificarInvariantes(e, T);
  });

  it('firma inválida o fuera de ventana: 401 y nada se escribe', async () => {
    const cuerpo = JSON.stringify({ pedidoId: 'pd-3', items: [{ productoId: 'lapiz', cantidad: 1 }], confirmadoEn: '2026-11-04T14:59:00Z' });
    const marcaTiempo = String(e.reloj.ahora);
    const mala = await confirmarPedidoFirmado(
      { db: e.db, secreto: SECRETO, ahora: () => e.reloj.ahora },
      { tenantId: T, marcaTiempo, firma: calcularFirma('otro-secreto', marcaTiempo, cuerpo), cuerpo },
    );
    expect(mala.estado).toBe(401);
    const vieja = await confirmarPedidoFirmado(
      { db: e.db, secreto: SECRETO, ahora: () => e.reloj.ahora + 6 * 60 * 1000 },
      { tenantId: T, marcaTiempo, firma: calcularFirma(SECRETO, marcaTiempo, cuerpo), cuerpo },
    );
    expect(vieja.estado).toBe(401);
    expect(doc(e, T, 'operaciones/nc-pd-3')).toBeUndefined();
  });
});

describe('pedido.confirmado por la bandeja', () => {
  const evento = async (pedidoId: string): Promise<SobreEvento> => {
    const datos: DatosPedidoConfirmadoV1 = {
      pedidoId, mercado: 'AR', moneda: 'ARS', total: 3000000, cotizacion: await cotizacionVigente(e, 'AR'),
      lineas: [{ productoId: 'lapiz', cantidad: 3 }], confirmadoEn: '2026-11-04T14:59:00Z',
    };
    return { id: `pc-${pedidoId}`, tipo: 'pedido.confirmado', version: 1, tenantId: T, origen: 'pedidos', ocurridoEn: '2026-11-04T14:59:00Z', claveIdempotencia: `pc-${pedidoId}`, datos };
  };

  it('descuenta siempre de tienda (el evento ya no trae almacén), una sola vez con entrega duplicada', async () => {
    await publicarEnBandeja(e.db, await evento('pd-4'));
    const r = await e.bandeja.entregar(T, { duplicados: 2 });
    expect(r.fallidas).toEqual([]);
    expect(doc(e, T, 'existencias/lapiz__tienda')?.['cantidad']).toBe(7);
    expect(doc(e, T, 'existencias/lapiz__deposito-1')?.['cantidad']).toBe(5);
    expect(doc(e, T, 'operaciones/nc-pd-4')).toBeDefined();
    verificarInvariantes(e, T);
  });

  it('un pedido sin stock queda auditado, se da por procesado y no descuenta nada', async () => {
    const ev = await evento('pd-5');
    (ev.datos as { lineas: unknown }).lineas = [{ productoId: 'lapiz', cantidad: 99 }];
    await publicarEnBandeja(e.db, ev);
    const r = await e.bandeja.entregar(T, { duplicados: 1 });
    expect(r.fallidas).toEqual([]);
    expect(doc(e, T, 'operaciones/nc-pd-5')).toBeUndefined();
    expect(doc(e, T, 'existencias/lapiz__tienda')?.['cantidad']).toBe(10);
    expect(e.db.coleccion(`tenants/${T}/auditoria`).some((a) => a.datos['accion'] === 'inventarios.pedido-rechazado')).toBe(true);
  });
});
