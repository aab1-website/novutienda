import { beforeEach, describe, expect, it } from 'vitest';
import type { SobreEvento } from '@plataforma/nucleo';
import {
  aplicarSalida,
  calcularFirma,
  confirmarPedido,
  confirmarPedidoFirmado,
  consumirPedidoConfirmado,
  consumirVentaAnulada,
  ejecutorDesde,
  OperacionConflicto,
  prepararSalida,
  verificarFirma,
  VENTANA_FIRMA_MS,
} from './api.js';
import type { DobleDb } from './doble-db.js';
import { altaProducto, CAJ, cargar, contar, doc, nuevoEntorno, producto, T, verificarInvariantes } from './entorno.js';

let db: DobleDb;
const pedir = (pedidoId: string, items: { productoId: string; cantidad: number }[]) =>
  db.runTransaction((tx) => confirmarPedido(tx, { tenantId: T, pedidoId, items }));

beforeEach(async () => {
  db = await nuevoEntorno();
  await altaProducto(db, producto('lapiz'));
  await altaProducto(db, producto('celular', { conSerie: true, garantiaMeses: 6 }));
  await cargar(db, 'lapiz', 'tienda', 5);
  await cargar(db, 'lapiz', 'deposito-1', 50); // el pedido NO descuenta del depósito
  await cargar(db, 'celular', 'tienda', 3, ['A', 'B', 'C']);
});

describe('confirmarPedido', () => {
  it('descuenta siempre de tienda y asigna la serie más antigua', async () => {
    const r = await pedir('p1', [{ productoId: 'lapiz', cantidad: 2 }, { productoId: 'celular', cantidad: 2 }]);
    expect(r).toMatchObject({ ok: true, operacionId: 'nc-p1', repetida: false });
    expect(doc(db, 'existencias', 'lapiz__tienda')?.['cantidad']).toBe(3);
    expect(doc(db, 'existencias', 'lapiz__deposito-1')?.['cantidad']).toBe(50);
    expect(doc(db, 'unidades', 'celular__A')).toMatchObject({ estado: 'vendida', ventaRef: { tipo: 'pedido', id: 'p1' } });
    expect(doc(db, 'unidades', 'celular__B')?.['estado']).toBe('vendida');
    expect(doc(db, 'unidades', 'celular__C')?.['estado']).toBe('disponible');
    expect(doc(db, 'movimientos', 'nc-p1__lapiz__tienda')).toMatchObject({ tipo: 'pedido', delta: -2 });
    verificarInvariantes(db);
  });

  it('sin stock rechaza, devuelve faltantes y no escribe stock ni operación', async () => {
    const r = await pedir('p1', [{ productoId: 'lapiz', cantidad: 6 }, { productoId: 'celular', cantidad: 4 }]);
    expect(r).toEqual({
      ok: false,
      faltantes: [
        { productoId: 'lapiz', almacenId: 'tienda', pedido: 6, disponible: 5 },
        { productoId: 'celular', almacenId: 'tienda', pedido: 4, disponible: 3 },
      ],
    });
    expect(doc(db, 'operaciones', 'nc-p1')).toBeUndefined();
    expect(doc(db, 'existencias', 'lapiz__tienda')?.['cantidad']).toBe(5);
    expect(db.coleccion(`tenants/${T}/auditoria`).some((a) => a.datos['accion'] === 'inventarios.pedido-rechazado')).toBe(true);
    verificarInvariantes(db);
    // tras reponer, el mismo pedido puede confirmarse
    await cargar(db, 'lapiz', 'tienda', 1);
    await cargar(db, 'celular', 'tienda', 1, ['D']);
    expect((await pedir('p1', [{ productoId: 'lapiz', cantidad: 6 }, { productoId: 'celular', cantidad: 4 }])).ok).toBe(true);
    verificarInvariantes(db);
  });

  it('es idempotente por pedido; otro contenido es conflicto', async () => {
    await pedir('p1', [{ productoId: 'lapiz', cantidad: 2 }, { productoId: 'celular', cantidad: 1 }]);
    const otra = await pedir('p1', [{ productoId: 'celular', cantidad: 1 }, { productoId: 'lapiz', cantidad: 2 }]);
    expect(otra).toMatchObject({ ok: true, repetida: true });
    await expect(pedir('p1', [{ productoId: 'lapiz', cantidad: 3 }])).rejects.toBeInstanceOf(OperacionConflicto);
    expect(doc(db, 'productos', 'lapiz')?.['stockTotal']).toBe(53);
    expect(contar(db, 'movimientos')).toBe(5);
    verificarInvariantes(db);
  });

  it('un pedido y una venta del mismo código no chocan (operaciones distintas)', async () => {
    await pedir('x1', [{ productoId: 'lapiz', cantidad: 1 }]);
    await db.runTransaction(async (tx) => {
      const plan = await prepararSalida(tx, T, [{ productoId: 'lapiz', cantidad: 1, almacenId: 'tienda' }]);
      aplicarSalida(tx, plan, { tipo: 'venta', id: 'x1' }, CAJ);
    });
    expect(doc(db, 'existencias', 'lapiz__tienda')?.['cantidad']).toBe(3);
  });
});

describe('firma HMAC', () => {
  const secreto = 'secreto-de-prueba';
  const ahora = Date.parse('2026-11-04T12:00:00Z');
  const cuerpo = JSON.stringify({ pedidoId: 'p1', items: [{ productoId: 'lapiz', cantidad: 1 }], confirmadoEn: '2026-11-04T11:59:00Z' });
  const marca = String(ahora);
  const firma = calcularFirma(secreto, marca, cuerpo);

  it('acepta una firma válida dentro de la ventana', () => {
    expect(verificarFirma({ secreto, marcaTiempo: marca, cuerpo, firma, ahoraMs: ahora })).toEqual({ ok: true });
    expect(verificarFirma({ secreto, marcaTiempo: marca, cuerpo, firma, ahoraMs: ahora + VENTANA_FIRMA_MS })).toEqual({ ok: true });
    expect(verificarFirma({ secreto, marcaTiempo: marca, cuerpo, firma, ahoraMs: ahora - VENTANA_FIRMA_MS })).toEqual({ ok: true });
  });

  it('rechaza fuera de la ventana de 5 minutos (pasado y futuro)', () => {
    expect(verificarFirma({ secreto, marcaTiempo: marca, cuerpo, firma, ahoraMs: ahora + VENTANA_FIRMA_MS + 1 })).toEqual({ ok: false, motivo: 'fuera-de-ventana' });
    expect(verificarFirma({ secreto, marcaTiempo: marca, cuerpo, firma, ahoraMs: ahora - VENTANA_FIRMA_MS - 1 })).toEqual({ ok: false, motivo: 'fuera-de-ventana' });
  });

  it('rechaza cuerpo alterado, secreto distinto, marca alterada y formatos inválidos', () => {
    const base = { secreto, marcaTiempo: marca, cuerpo, firma, ahoraMs: ahora };
    expect(verificarFirma({ ...base, cuerpo: `${cuerpo} ` })).toEqual({ ok: false, motivo: 'firma-invalida' });
    expect(verificarFirma({ ...base, secreto: 'otro' })).toEqual({ ok: false, motivo: 'firma-invalida' });
    expect(verificarFirma({ ...base, marcaTiempo: String(ahora + 1) })).toEqual({ ok: false, motivo: 'firma-invalida' });
    expect(verificarFirma({ ...base, marcaTiempo: '123' })).toEqual({ ok: false, motivo: 'marca-invalida' });
    expect(verificarFirma({ ...base, firma: 'abc' })).toEqual({ ok: false, motivo: 'firma-invalida' });
    expect(verificarFirma({ ...base, firma: firma.toUpperCase() })).toEqual({ ok: false, motivo: 'firma-invalida' });
    expect(verificarFirma({ ...base, firma: '' })).toEqual({ ok: false, motivo: 'firma-invalida' });
    expect(() => calcularFirma('', marca, cuerpo)).toThrow();
  });

  const llamar = (c: string, o: { firmaExtra?: string; ahora?: number } = {}) =>
    confirmarPedidoFirmado(
      { db, secreto, ahora: () => o.ahora ?? ahora },
      { tenantId: T, marcaTiempo: marca, firma: o.firmaExtra ?? calcularFirma(secreto, marca, c), cuerpo: c },
    );

  it('endpoint: 200 ok, 200 repetido, 401, 400, 409 con faltantes y con contenido distinto', async () => {
    expect(await llamar(cuerpo)).toEqual({ estado: 200, cuerpo: { ok: true, operacionId: 'nc-p1', repetida: false } });
    expect((await llamar(cuerpo)).cuerpo).toMatchObject({ repetida: true });
    expect(await llamar(cuerpo, { firmaExtra: 'a'.repeat(64) })).toEqual({ estado: 401, cuerpo: { error: 'firma-invalida' } });
    expect((await llamar(cuerpo, { ahora: ahora + 6 * 60_000 })).estado).toBe(401);
    expect((await llamar('no es json')).estado).toBe(400);
    const mal = JSON.stringify({ pedidoId: 'p2', items: [{ productoId: 'lapiz', cantidad: 0 }], confirmadoEn: '2026-11-04T11:59:00Z' });
    expect((await llamar(mal)).estado).toBe(400);
    const sobrante = JSON.stringify({ pedidoId: 'p2', items: [{ productoId: 'lapiz', cantidad: 1 }], confirmadoEn: '2026-11-04T11:59:00Z', extra: 1 });
    expect((await llamar(sobrante)).estado).toBe(400);
    const sinStock = JSON.stringify({ pedidoId: 'p3', items: [{ productoId: 'lapiz', cantidad: 99 }], confirmadoEn: '2026-11-04T11:59:00Z' });
    const r = await llamar(sinStock);
    expect(r.estado).toBe(409);
    expect(r.cuerpo).toMatchObject({ ok: false, faltantes: [{ productoId: 'lapiz', pedido: 99, disponible: 4 }] });
    const otro = JSON.stringify({ pedidoId: 'p1', items: [{ productoId: 'lapiz', cantidad: 2 }], confirmadoEn: '2026-11-04T11:59:00Z' });
    expect((await llamar(otro)).cuerpo).toMatchObject({ error: 'already-exists' });
    verificarInvariantes(db);
  });

  it('una firma no vale para otro tenant ni se acepta con firma rota sin tocar datos', async () => {
    const antes = db.docs.size;
    expect((await llamar(cuerpo, { firmaExtra: firma.replace(/.$/, firma.endsWith('0') ? '1' : '0') })).estado).toBe(401);
    expect(db.docs.size).toBe(antes);
  });
});

const sobre = (tipo: string, id: string, clave: string, datos: unknown): SobreEvento => ({
  id,
  tipo,
  version: 1,
  tenantId: T,
  origen: 'pos',
  ocurridoEn: '2026-11-04T12:00:00Z',
  claveIdempotencia: clave,
  datos,
});

describe('eventos consumidos', () => {
  const cotizacion = { cotizacionId: 'AR-1', par: 'ARS/USD', valor: 1200, fecha: '2026-11-04', fuente: 'BNA', estado: 'vigente' };
  const pedidoEv = (pedidoId: string, lineas: unknown[], id = `e-${pedidoId}`) =>
    sobre('pedido.confirmado', id, pedidoId, { pedidoId, mercado: 'AR', moneda: 'ARS', total: 1000, cotizacion, lineas, confirmadoEn: '2026-11-04T11:59:00Z' });

  it('pedido.confirmado descuenta de tienda (siempre de la tienda) una sola vez', async () => {
    const ev = pedidoEv('p1', [{ productoId: 'lapiz', cantidad: 2 }]);
    expect(await consumirPedidoConfirmado(ejecutorDesde(db), ev)).toBe(true);
    expect(await consumirPedidoConfirmado(ejecutorDesde(db), ev)).toBe(false);
    expect(await consumirPedidoConfirmado(ejecutorDesde(db), { ...ev, id: 'otro-id' })).toBe(false); // mismo hecho con otro id
    expect(doc(db, 'existencias', 'lapiz__tienda')?.['cantidad']).toBe(3);
    expect(doc(db, 'existencias', 'lapiz__deposito-1')?.['cantidad']).toBe(50);
    verificarInvariantes(db);
  });

  it('pedido sin stock: el evento se da por procesado y queda auditado, sin descontar', async () => {
    const ev = pedidoEv('p9', [{ productoId: 'lapiz', cantidad: 60 }]);
    expect(await consumirPedidoConfirmado(ejecutorDesde(db), ev)).toBe(true);
    expect(doc(db, 'operaciones', 'nc-p9')).toBeUndefined();
    expect(doc(db, 'existencias', 'lapiz__tienda')?.['cantidad']).toBe(5);
  });

  it('venta.anulada revierte stock y series; repetir el evento no duplica', async () => {
    await db.runTransaction(async (tx) => {
      const plan = await prepararSalida(tx, T, [
        { productoId: 'lapiz', cantidad: 2, almacenId: 'tienda' },
        { productoId: 'celular', cantidad: 1, almacenId: 'tienda', series: ['B'] },
      ]);
      aplicarSalida(tx, plan, { tipo: 'venta', id: 'v1' }, CAJ);
    });
    const datos = {
      ventaId: 'v1',
      turnoId: 't1',
      motivo: 'error',
      anuladaPor: 'u-caj',
      aprobadoPor: 'u-sup',
      lineas: [
        { productoId: 'lapiz', cantidad: 2, almacenId: 'tienda', series: [] },
        { productoId: 'celular', cantidad: 1, almacenId: 'tienda', series: ['B'] },
      ],
      reembolsos: [{ medio: 'efectivo', moneda: 'BOB', monto: 100 }],
      turnoIdReembolso: 't1',
    };
    const ev = sobre('venta.anulada', 'ea1', 'v1', datos);
    expect(await consumirVentaAnulada(ejecutorDesde(db), ev)).toBe(true);
    expect(await consumirVentaAnulada(ejecutorDesde(db), ev)).toBe(false);
    expect(doc(db, 'existencias', 'lapiz__tienda')?.['cantidad']).toBe(5);
    expect(doc(db, 'unidades', 'celular__B')?.['estado']).toBe('disponible');
    expect(doc(db, 'movimientos', 'venta-anula-v1__lapiz__tienda')).toMatchObject({ por: 'u-sup', tipo: 'anulacion' });
    verificarInvariantes(db);
  });

  it('venta.anulada con líneas distintas a las descontadas falla y no escribe', async () => {
    await db.runTransaction(async (tx) => {
      const plan = await prepararSalida(tx, T, [{ productoId: 'lapiz', cantidad: 2, almacenId: 'tienda' }]);
      aplicarSalida(tx, plan, { tipo: 'venta', id: 'v2' }, CAJ);
    });
    const ev = sobre('venta.anulada', 'ea2', 'v2', {
      ventaId: 'v2', turnoId: 't1', motivo: 'x', anuladaPor: 'u-caj', aprobadoPor: 'u-sup',
      lineas: [{ productoId: 'lapiz', cantidad: 1, almacenId: 'tienda', series: [] }],
      reembolsos: [{ medio: 'efectivo', moneda: 'BOB', monto: 1 }], turnoIdReembolso: 't1',
    });
    await expect(consumirVentaAnulada(ejecutorDesde(db), ev)).rejects.toThrow(/no coinciden/);
    expect(doc(db, 'existencias', 'lapiz__tienda')?.['cantidad']).toBe(3);
    verificarInvariantes(db);
  });

  it('un evento inválido o de otro tipo se rechaza', async () => {
    await expect(consumirPedidoConfirmado(ejecutorDesde(db), { ...pedidoEv('p1', []), id: 'x' })).rejects.toThrow();
    await expect(consumirPedidoConfirmado(ejecutorDesde(db), sobre('venta.anulada', 'y', 'y', {}))).rejects.toThrow();
  });
});
