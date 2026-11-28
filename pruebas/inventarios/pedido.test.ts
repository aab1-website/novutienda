import { beforeEach, describe, expect, it } from 'vitest';
import type { SobreEvento } from '@novutienda/nucleo';
import { calcularFirma, verificarFirma, VENTANA_FIRMA_MS } from '@novutienda/nucleo/servidor';
import {
  aplicarSalida,
  anularPedido,
  anularPedidoFirmado,
  confirmarPedido,
  confirmarPedidoFirmado,
  consumirPedidoConfirmado,
  consumirVentaAnulada,
  ejecutorDesde,
  leerCuerpoAnulacion,
  leerCuerpoPedido,
  OperacionConflicto,
  PedidoAnulado,
  prepararSalida,
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
  await cargar(db, 'celular', 'tienda', 3, ['SN-A', 'SN-B', 'SN-C']);
});

describe('confirmarPedido', () => {
  it('descuenta siempre de tienda y asigna la serie más antigua', async () => {
    const r = await pedir('p1', [{ productoId: 'lapiz', cantidad: 2 }, { productoId: 'celular', cantidad: 2 }]);
    expect(r).toMatchObject({ ok: true, operacionId: 'nc-p1', repetida: false });
    expect(doc(db, 'existencias', 'lapiz__tienda')?.['cantidad']).toBe(3);
    expect(doc(db, 'existencias', 'lapiz__deposito-1')?.['cantidad']).toBe(50);
    expect(doc(db, 'unidades', 'celular__SN-A')).toMatchObject({ estado: 'vendida', ventaRef: { tipo: 'pedido', id: 'p1' } });
    expect(doc(db, 'unidades', 'celular__SN-B')?.['estado']).toBe('vendida');
    expect(doc(db, 'unidades', 'celular__SN-C')?.['estado']).toBe('disponible');
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
    await cargar(db, 'celular', 'tienda', 1, ['SN-D']);
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
        { productoId: 'celular', cantidad: 1, almacenId: 'tienda', series: ['SN-B'] },
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
        { productoId: 'celular', cantidad: 1, almacenId: 'tienda', series: ['SN-B'] },
      ],
      reembolsos: [{ medio: 'efectivo', moneda: 'BOB', monto: 100 }],
      turnoIdReembolso: 't1',
    };
    const ev = sobre('venta.anulada', 'ea1', 'v1', datos);
    expect(await consumirVentaAnulada(ejecutorDesde(db), ev)).toBe(true);
    expect(await consumirVentaAnulada(ejecutorDesde(db), ev)).toBe(false);
    expect(doc(db, 'existencias', 'lapiz__tienda')?.['cantidad']).toBe(5);
    expect(doc(db, 'unidades', 'celular__SN-B')?.['estado']).toBe('disponible');
    expect(doc(db, 'movimientos', 'venta-anula-v1__lapiz__tienda')).toMatchObject({ por: 'u-sup', tipo: 'anulacion' });
    verificarInvariantes(db);
  });

  it('venta.anulada v2 repone stock y series igual que la v1 (reembolso en otra moneda)', async () => {
    await db.runTransaction(async (tx) => {
      const plan = await prepararSalida(tx, T, [
        { productoId: 'lapiz', cantidad: 2, almacenId: 'tienda' },
        { productoId: 'celular', cantidad: 1, almacenId: 'tienda', series: ['SN-B'] },
      ]);
      aplicarSalida(tx, plan, { tipo: 'venta', id: 'v1' }, CAJ);
    });
    const ev = {
      ...sobre('venta.anulada', 'ea1b', 'v1', {
        ventaId: 'v1', turnoId: 't1', motivo: 'error', anuladaPor: 'u-caj', aprobadoPor: 'u-sup',
        lineas: [
          { productoId: 'lapiz', cantidad: 2, almacenId: 'tienda', series: [] },
          { productoId: 'celular', cantidad: 1, almacenId: 'tienda', series: ['SN-B'] },
        ],
        reembolsos: [{ medio: 'efectivo', moneda: 'CLP', monto: 100 }],
        turnoIdReembolso: 't1',
      }),
      version: 2,
    } as unknown as SobreEvento;
    expect(await consumirVentaAnulada(ejecutorDesde(db), ev)).toBe(true);
    expect(await consumirVentaAnulada(ejecutorDesde(db), ev)).toBe(false);
    expect(doc(db, 'existencias', 'lapiz__tienda')?.['cantidad']).toBe(5);
    expect(doc(db, 'unidades', 'celular__SN-B')?.['estado']).toBe('disponible');
    expect(doc(db, 'movimientos', 'venta-anula-v1__lapiz__tienda')).toMatchObject({ por: 'u-sup', tipo: 'anulacion' });
    verificarInvariantes(db);
  });

  it('pedido.confirmado v2 se rechaza (solo se entiende la versión 1)', async () => {
    const ev = { ...pedidoEv('p7', [{ productoId: 'lapiz', cantidad: 1 }]), version: 2 } as unknown as SobreEvento;
    await expect(consumirPedidoConfirmado(ejecutorDesde(db), ev)).rejects.toThrow();
    expect(doc(db, 'existencias', 'lapiz__tienda')?.['cantidad']).toBe(5);
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

describe('anular pedido', () => {
  const anular = (pedidoId: string) => db.runTransaction((tx) => anularPedido(tx, { tenantId: T, pedidoId }));

  it('devuelve stock y series a tienda, con movimiento, evento y auditoría', async () => {
    await pedir('p1', [{ productoId: 'lapiz', cantidad: 2 }, { productoId: 'celular', cantidad: 2 }]);
    expect(await anular('p1')).toEqual({ ok: true, operacionId: 'nc-anula-p1', repetida: false });
    expect(doc(db, 'existencias', 'lapiz__tienda')?.['cantidad']).toBe(5);
    expect(doc(db, 'existencias', 'lapiz__deposito-1')?.['cantidad']).toBe(50);
    expect(doc(db, 'existencias', 'celular__tienda')?.['cantidad']).toBe(3);
    expect(doc(db, 'unidades', 'celular__SN-A')?.['estado']).toBe('disponible');
    expect(doc(db, 'unidades', 'celular__SN-B')?.['estado']).toBe('disponible');
    expect(doc(db, 'movimientos', 'nc-anula-p1__lapiz__tienda')).toMatchObject({ tipo: 'anulacion', delta: 2, por: 'sistema-pedidos' });
    expect(doc(db, 'eventos', 'sc-nc-anula-p1__lapiz__tienda')).toMatchObject({ tipo: 'stock.cambiado', datos: { delta: 2, saldo: 5, motivo: 'anulacion' } });
    expect(db.coleccion(`tenants/${T}/auditoria`).some((a) => a.datos['accion'] === 'inventarios.reversion-pedido')).toBe(true);
    verificarInvariantes(db);
  });

  it('repetir la anulación no escribe nada', async () => {
    await pedir('p1', [{ productoId: 'lapiz', cantidad: 2 }]);
    await anular('p1');
    const antes = JSON.stringify([...db.docs]);
    expect(await anular('p1')).toEqual({ ok: true, operacionId: 'nc-anula-p1', repetida: true });
    expect(JSON.stringify([...db.docs])).toBe(antes);
  });

  it('pedido inexistente o rechazado por stock: pedido-no-encontrado', async () => {
    expect(await anular('nada')).toEqual({ ok: false, error: 'pedido-no-encontrado' });
    await pedir('p9', [{ productoId: 'lapiz', cantidad: 99 }]);
    expect(await anular('p9')).toEqual({ ok: false, error: 'pedido-no-encontrado' });
    expect(doc(db, 'operaciones', 'nc-anula-p9')).toBeUndefined();
  });

  it('confirmar un pedido anulado falla con PedidoAnulado y no descuenta (también al repetir la confirmación)', async () => {
    await pedir('p1', [{ productoId: 'lapiz', cantidad: 2 }]);
    await anular('p1');
    await expect(pedir('p1', [{ productoId: 'lapiz', cantidad: 2 }])).rejects.toBeInstanceOf(PedidoAnulado);
    await expect(pedir('p1', [{ productoId: 'lapiz', cantidad: 1 }])).rejects.toBeInstanceOf(PedidoAnulado);
    expect(doc(db, 'existencias', 'lapiz__tienda')?.['cantidad']).toBe(5);
    verificarInvariantes(db);
  });

  it('un evento pedido.confirmado de un pedido anulado se da por procesado sin descontar', async () => {
    await pedir('p1', [{ productoId: 'lapiz', cantidad: 2 }]);
    await anular('p1');
    const ev = sobre('pedido.confirmado', 'e-p1', 'p1', { pedidoId: 'p1', mercado: 'AR', moneda: 'ARS', total: 1000, cotizacion: { cotizacionId: 'AR-1', par: 'ARS/USD', valor: 1200, fecha: '2026-11-04', fuente: 'BNA', estado: 'vigente' }, lineas: [{ productoId: 'lapiz', cantidad: 2 }], confirmadoEn: '2026-11-04T11:59:00Z' });
    expect(await consumirPedidoConfirmado(ejecutorDesde(db), ev)).toBe(true);
    expect(doc(db, 'existencias', 'lapiz__tienda')?.['cantidad']).toBe(5);
  });

  it('una serie que ya no está vendida en el pedido bloquea la anulación sin escribir', async () => {
    await pedir('p1', [{ productoId: 'celular', cantidad: 1 }]);
    const ruta = [...db.docs.keys()].find((r) => r.endsWith('/unidades/celular__SN-A')) as string;
    const u = db.docs.get(ruta)?.datos as Record<string, unknown>;
    db.docs.set(ruta, { datos: { ...u, estado: 'disponible' }, version: 9 });
    const antes = JSON.stringify([...db.docs]);
    await expect(anular('p1')).rejects.toMatchObject({ codigo: 'failed-precondition' });
    expect(JSON.stringify([...db.docs])).toBe(antes);
  });
});

describe('anular pedido firmado', () => {
  const secreto = 'secreto-de-prueba';
  const ahora = Date.parse('2026-11-04T12:00:00Z');
  const marca = String(ahora);
  const conf = JSON.stringify({ pedidoId: 'p1', items: [{ productoId: 'lapiz', cantidad: 2 }], confirmadoEn: '2026-11-04T11:59:00Z' });
  const anul = JSON.stringify({ pedidoId: 'p1', anuladoEn: '2026-11-04T11:59:30Z', tenantId: T });
  const deps = (autorizado?: () => Promise<boolean>) => ({ db, secreto, ahora: () => ahora, ...(autorizado ? { autorizado } : {}) });
  const sol = (c: string, firma?: string) => ({ tenantId: T, marcaTiempo: marca, firma: firma ?? calcularFirma(secreto, marca, c), cuerpo: c });

  it('200 ok, 200 repetida y devuelve el stock', async () => {
    await confirmarPedidoFirmado(deps(), sol(conf));
    expect(await anularPedidoFirmado(deps(), sol(anul))).toEqual({ estado: 200, cuerpo: { ok: true, operacionId: 'nc-anula-p1', repetida: false } });
    expect(doc(db, 'existencias', 'lapiz__tienda')?.['cantidad']).toBe(5);
    expect((await anularPedidoFirmado(deps(), sol(anul))).cuerpo).toMatchObject({ ok: true, repetida: true });
    verificarInvariantes(db);
  });

  it('409 pedido-no-encontrado, también para un pedido rechazado por stock', async () => {
    expect(await anularPedidoFirmado(deps(), sol(anul))).toEqual({ estado: 409, cuerpo: { ok: false, error: 'pedido-no-encontrado' } });
    const grande = JSON.stringify({ pedidoId: 'p1', items: [{ productoId: 'lapiz', cantidad: 99 }], confirmadoEn: '2026-11-04T11:59:00Z' });
    expect((await confirmarPedidoFirmado(deps(), sol(grande))).estado).toBe(409);
    expect((await anularPedidoFirmado(deps(), sol(anul))).cuerpo).toEqual({ ok: false, error: 'pedido-no-encontrado' });
  });

  it('400 tenant-distinto si el cuerpo firmado nombra otro tenant: no escribe nada', async () => {
    await confirmarPedidoFirmado(deps(), sol(conf));
    const otro = JSON.stringify({ pedidoId: 'p1', anuladoEn: '2026-11-04T11:59:30Z', tenantId: 'otro-tenant' });
    expect(await anularPedidoFirmado(deps(), sol(otro))).toEqual({ estado: 400, cuerpo: { ok: false, error: 'tenant-distinto' } });
    expect(doc(db, 'operaciones', 'nc-anula-p1')).toBeUndefined();
    expect(doc(db, 'existencias', 'lapiz__tienda')?.['cantidad']).toBe(3);
  });

  it('anuladoEn queda en la auditoría de la anulación (una sola vez)', async () => {
    await confirmarPedidoFirmado(deps(), sol(conf));
    const cuenta = () => [...db.docs.values()].filter((d) => d.datos?.['accion'] === 'inventarios.pedido-anulado');
    await anularPedidoFirmado(deps(), sol(anul));
    await anularPedidoFirmado(deps(), sol(anul));
    const a = cuenta();
    expect(a).toHaveLength(1);
    expect(JSON.stringify(a[0]?.datos)).toContain('2026-11-04T11:59:30Z');
  });

  it('409 si el producto fue borrado', async () => {
    await confirmarPedidoFirmado(deps(), sol(conf));
    const ruta = [...db.docs.keys()].find((r) => r.endsWith('/productos/lapiz')) as string;
    db.docs.set(ruta, { datos: undefined, version: 9 });
    const r = await anularPedidoFirmado(deps(), sol(anul));
    expect(r.estado).toBe(409);
    expect(r.cuerpo['error']).not.toBe('pedido-no-encontrado');
  });

  it('401 con firma inválida o vencida y con el módulo apagado; 400 con cuerpo inválido', async () => {
    expect(await anularPedidoFirmado(deps(), sol(anul, 'a'.repeat(64)))).toEqual({ estado: 401, cuerpo: { error: 'firma-invalida' } });
    expect((await anularPedidoFirmado({ ...deps(), ahora: () => ahora + 6 * 60_000 }, sol(anul))).estado).toBe(401);
    expect(await anularPedidoFirmado(deps(async () => false), sol(anul))).toEqual({ estado: 401, cuerpo: { error: 'credencial_invalida' } });
    for (const mal of ['no es json', '[]', JSON.stringify({ pedidoId: 'p1', tenantId: T }), JSON.stringify({ pedidoId: 'p1', anuladoEn: '2026-11-04T11:59:30Z' }), JSON.stringify({ pedidoId: 'p1', anuladoEn: '2026-11-04 11:59', tenantId: T }), JSON.stringify({ pedidoId: 'p1', anuladoEn: '2026-11-04T11:59:30Z', tenantId: T, extra: 1 }), JSON.stringify({ pedidoId: '', anuladoEn: '2026-11-04T11:59:30Z', tenantId: T })]) {
      expect((await anularPedidoFirmado(deps(), sol(mal))).estado).toBe(400);
    }
    expect(() => leerCuerpoAnulacion(anul)).not.toThrow();
  });

  it('los cuerpos no se cruzan entre endpoints (400 en ambos sentidos) y confirmar tras anular da 409 pedido-anulado', async () => {
    expect((await anularPedidoFirmado(deps(), sol(conf))).estado).toBe(400);
    expect((await confirmarPedidoFirmado(deps(), sol(anul))).estado).toBe(400);
    await confirmarPedidoFirmado(deps(), sol(conf));
    await anularPedidoFirmado(deps(), sol(anul));
    const r = await confirmarPedidoFirmado(deps(), sol(conf));
    expect(r).toMatchObject({ estado: 409, cuerpo: { ok: false, error: 'pedido-anulado' } });
    expect(doc(db, 'existencias', 'lapiz__tienda')?.['cantidad']).toBe(5);
    verificarInvariantes(db);
  });
});

describe('nota del cliente en el pedido', () => {
  const secreto = 'secreto-de-prueba';
  const ahora = Date.parse('2026-11-04T12:00:00Z');
  const marca = String(ahora);
  const cuerpoCon = (extra: Record<string, unknown>) =>
    JSON.stringify({ pedidoId: 'n1', items: [{ productoId: 'lapiz', cantidad: 1 }], confirmadoEn: '2026-11-04T11:59:00Z', ...extra });
  const llamar = (c: string, firma?: string) =>
    confirmarPedidoFirmado({ db, secreto, ahora: () => ahora }, { tenantId: T, marcaTiempo: marca, firma: firma ?? calcularFirma(secreto, marca, c), cuerpo: c });

  it('con nota: la guarda en la operación y en el movimiento', async () => {
    expect((await llamar(cuerpoCon({ nota: 'Sin bolsa, por favor' }))).estado).toBe(200);
    expect(doc(db, 'operaciones', 'nc-n1')?.['nota']).toBe('Sin bolsa, por favor');
    expect(doc(db, 'movimientos', 'nc-n1__lapiz__tienda')?.['nota']).toBe('Sin bolsa, por favor');
    verificarInvariantes(db);
  });

  it('sin nota o con nota vacía: no guarda el campo', async () => {
    expect((await llamar(cuerpoCon({}))).estado).toBe(200);
    expect(doc(db, 'operaciones', 'nc-n1')).not.toHaveProperty('nota');
    expect(doc(db, 'movimientos', 'nc-n1__lapiz__tienda')).not.toHaveProperty('nota');
    expect(leerCuerpoPedido(cuerpoCon({ nota: '' }))).not.toHaveProperty('nota');
  });

  it('acepta 500 caracteres (por caracteres, no bytes) y rechaza 501', () => {
    expect(leerCuerpoPedido(cuerpoCon({ nota: 'ñ'.repeat(500) })).nota).toHaveLength(500);
    expect(leerCuerpoPedido(cuerpoCon({ nota: '😀'.repeat(500) })).nota).toBe('😀'.repeat(500));
    expect(() => leerCuerpoPedido(cuerpoCon({ nota: 'a'.repeat(501) }))).toThrow();
    expect(() => leerCuerpoPedido(cuerpoCon({ nota: '😀'.repeat(501) }))).toThrow();
  });

  it('rechaza caracteres de control (incluido el salto de línea), tipos distintos y claves desconocidas con 400', async () => {
    for (const nota of ['a\nb', 'a\tb', 'a\u0000b', 'a\u007fb', 'a b', 5, null, true, ['x'], { a: 1 }]) {
      expect((await llamar(cuerpoCon({ nota }))).estado, JSON.stringify(nota)).toBe(400);
    }
    expect((await llamar(cuerpoCon({ nota: 'hola', otra: 1 }))).estado).toBe(400);
    expect((await llamar(cuerpoCon({ notas: 'hola' }))).estado).toBe(400);
    expect(doc(db, 'operaciones', 'nc-n1')).toBeUndefined();
  });

  it('la firma cubre la nota: alterarla invalida la firma', async () => {
    const firmado = calcularFirma(secreto, marca, cuerpoCon({ nota: 'Hola' }));
    expect(await llamar(cuerpoCon({ nota: 'Hola!' }), firmado)).toEqual({ estado: 401, cuerpo: { error: 'firma-invalida' } });
    expect((await llamar(cuerpoCon({ nota: 'Hola' }), firmado)).estado).toBe(200);
  });

  it('reintento con otra nota (o sin ella): repetido y conserva la primera', async () => {
    await llamar(cuerpoCon({ nota: 'Primera' }));
    expect((await llamar(cuerpoCon({ nota: 'Segunda' }))).cuerpo).toMatchObject({ repetida: true });
    expect((await llamar(cuerpoCon({}))).cuerpo).toMatchObject({ repetida: true });
    expect(doc(db, 'operaciones', 'nc-n1')?.['nota']).toBe('Primera');
    expect(doc(db, 'movimientos', 'nc-n1__lapiz__tienda')?.['nota']).toBe('Primera');
    expect(doc(db, 'existencias', 'lapiz__tienda')?.['cantidad']).toBe(4);
  });
});
