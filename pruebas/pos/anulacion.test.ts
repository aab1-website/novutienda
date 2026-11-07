import { validarEvento } from '@novutienda/nucleo';
import {
  abrirTurno, aprobarAnulacion, cerrarTurno, cobrarCredito, confirmarVenta, ErrorPos, reconstruirTotales, registrarMovimientoCaja, solicitarAnulacion,
} from '@novutienda/pos';
import { describe, expect, it } from 'vitest';
import { T, TURNO, UUID, abrir, adm, auditoria, caj, caj2, carritoP1, crearEntorno, efectivo, eventos, stock, sup, venderP1 } from './ayudas.js';

const codigo = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    return e instanceof ErrorPos ? e.codigo : `otro:${String(e)}`;
  }
  return 'sin-error';
};

describe('anulación', () => {
  it('el vendedor solicita, sup/adm aprueba: revierte stock, reembolsa en el turno abierto y publica el evento', async () => {
    const e = crearEntorno();
    await abrir(e, caj, { BOB: 10000 });
    await venderP1(e, 1, caj, 2);
    expect(stock(e, 'tienda', 'p1')).toBe(8);
    await solicitarAnulacion(e.deps, T, caj, UUID(1), 'error de digitación');
    const r = await aprobarAnulacion(e.deps, T, sup, UUID(1), 'aprobada por supervisión');
    expect(r.reembolsos).toEqual([{ medio: 'efectivo', moneda: 'BOB', monto: 14000 }]);
    expect(stock(e, 'tienda', 'p1')).toBe(10);
    expect(e.db.dato(`tenants/${T}/ventas/${UUID(1)}`)).toMatchObject({ estado: 'anulada' });
    expect(e.db.dato(`tenants/${T}/anulaciones/${UUID(1)}`)).toMatchObject({ aprobadoPor: 'u-sup', solicitadoPor: 'u-caj' });
    const ev = eventos(e, 'venta.anulada');
    expect(ev).toHaveLength(1);
    expect(validarEvento(ev[0]).ok).toBe(true);
    expect(auditoria(e).some((a) => a['accion'] === 'pos.anulacion.aprobar')).toBe(true);
    const turno = e.db.dato(`tenants/${T}/turnos/${TURNO}`) as { totales: { BOB: { efectivo: number } } };
    expect(turno.totales.BOB.efectivo).toBe(0);
  });

  it('el reembolso entra en el turno abierto, distinto del original', async () => {
    const e = crearEntorno();
    await abrir(e, caj, { BOB: 0 });
    await venderP1(e, 1);
    await cerrarTurno(e.deps, T, caj, TURNO, { BOB: 7000 });
    await abrirTurno(e.deps, T, caj2, UUID(901), { BOB: 20000 });
    await solicitarAnulacion(e.deps, T, caj, UUID(1), 'devolución');
    const r = await aprobarAnulacion(e.deps, T, adm, UUID(1), 'aprobada por supervisión');
    expect(r.turnoIdReembolso).toBe(UUID(901));
    const ev = eventos(e, 'venta.anulada')[0]?.['datos'] as { turnoId: string; turnoIdReembolso: string };
    expect(ev).toMatchObject({ turnoId: TURNO, turnoIdReembolso: UUID(901) });
    const ops = {
      ventas: e.db.coleccion(`tenants/${T}/ventas`) as never,
      cobrosCredito: [],
      movimientos: [],
      anulaciones: e.db.coleccion(`tenants/${T}/anulaciones`) as never,
    };
    expect(reconstruirTotales(UUID(901), ops)).toEqual((e.db.dato(`tenants/${T}/turnos/${UUID(901)}`) as { totales: unknown }).totales);
    expect(reconstruirTotales(TURNO, ops)).toMatchObject({ BOB: { efectivo: 7000 } });
  });

  it('no se anula dos veces', async () => {
    const e = crearEntorno();
    await abrir(e);
    await venderP1(e, 1);
    await solicitarAnulacion(e.deps, T, caj, UUID(1), 'x');
    await aprobarAnulacion(e.deps, T, sup, UUID(1), 'aprobada por supervisión');
    expect(await codigo(aprobarAnulacion(e.deps, T, adm, UUID(1), 'aprobada por supervisión'))).toBe('venta-ya-anulada');
    expect(await codigo(solicitarAnulacion(e.deps, T, caj, UUID(1), 'otra'))).toBe('venta-ya-anulada');
    expect(stock(e, 'tienda', 'p1')).toBe(10);
    expect(eventos(e, 'venta.anulada')).toHaveLength(1);
  });

  it('guarda y audita el motivo del aprobador junto al del solicitante; exige que sea no vacío', async () => {
    const e = crearEntorno();
    await abrir(e);
    await venderP1(e, 1);
    await solicitarAnulacion(e.deps, T, caj, UUID(1), 'error de digitación');
    expect(await codigo(aprobarAnulacion(e.deps, T, sup, UUID(1), '  '))).toBe('entrada-invalida');
    await aprobarAnulacion(e.deps, T, sup, UUID(1), 'verificado con el cliente');
    expect(e.db.dato(`tenants/${T}/anulaciones/${UUID(1)}`)).toMatchObject({ motivo: 'error de digitación', motivoAprobador: 'verificado con el cliente' });
    const a = auditoria(e).find((x) => x['accion'] === 'pos.anulacion.aprobar');
    expect(a).toMatchObject({ motivo: 'verificado con el cliente' });
    expect(JSON.stringify(a)).toContain('error de digitación');
  });

  it('nadie aprueba la anulación de una venta que vendió o que solicitó anular (autoaprobación)', async () => {
    const e = crearEntorno();
    await abrir(e, sup);
    await venderP1(e, 1, sup); // la vendió el supervisor
    await solicitarAnulacion(e.deps, T, sup, UUID(1), 'x');
    expect(await codigo(aprobarAnulacion(e.deps, T, sup, UUID(1), 'yo mismo'))).toBe('autoaprobacion');
    // Otra venta de un vendedor, cuya anulación solicita un supervisor: quien la solicitó tampoco la aprueba.
    await venderP1(e, 2, sup);
    await solicitarAnulacion(e.deps, T, adm, UUID(2), 'x');
    expect(await codigo(aprobarAnulacion(e.deps, T, adm, UUID(2), 'yo mismo'))).toBe('autoaprobacion');
    expect(await codigo(aprobarAnulacion(e.deps, T, adm, UUID(1), 'distinto'))).toBe('sin-error');
    expect(e.db.dato(`tenants/${T}/ventas/${UUID(2)}`)).toMatchObject({ estado: 'confirmada' });
    expect(stock(e, 'tienda', 'p1')).toBe(9);
  });

  it('dos aprobaciones simultáneas anulan una sola vez', async () => {
    const e = crearEntorno();
    await abrir(e);
    await venderP1(e, 1);
    await solicitarAnulacion(e.deps, T, caj, UUID(1), 'x');
    const r = await Promise.allSettled([aprobarAnulacion(e.deps, T, sup, UUID(1), 'aprobada por supervisión'), aprobarAnulacion(e.deps, T, adm, UUID(1), 'aprobada por supervisión')]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(stock(e, 'tienda', 'p1')).toBe(10);
  });

  it('el vendedor no aprueba; sin solicitud no se aprueba; sin turno abierto no hay reembolso', async () => {
    const e = crearEntorno();
    await abrir(e);
    await venderP1(e, 1);
    expect(await codigo(aprobarAnulacion(e.deps, T, caj, UUID(1), 'aprobada por supervisión'))).toBe('no-autorizado');
    expect(await codigo(aprobarAnulacion(e.deps, T, sup, UUID(1), 'aprobada por supervisión'))).toBe('anulacion-sin-solicitud');
    await solicitarAnulacion(e.deps, T, caj, UUID(1), 'x');
    await cerrarTurno(e.deps, T, caj, TURNO, { BOB: 17000 });
    expect(await codigo(aprobarAnulacion(e.deps, T, sup, UUID(1), 'aprobada por supervisión'))).toBe('sin-turno');
    expect(stock(e, 'tienda', 'p1')).toBe(9);
  });

  it('el vendedor solo solicita sobre sus ventas; faltan datos', async () => {
    const e = crearEntorno();
    await abrir(e);
    await venderP1(e, 1);
    expect(await codigo(solicitarAnulacion(e.deps, T, caj2, UUID(1), 'x'))).toBe('no-autorizado');
    expect(await codigo(solicitarAnulacion(e.deps, T, caj, UUID(1), ' '))).toBe('entrada-invalida');
    expect(await codigo(solicitarAnulacion(e.deps, T, caj, UUID(2), 'x'))).toBe('venta-inexistente');
    expect(await codigo(aprobarAnulacion(e.deps, T, sup, UUID(2), 'aprobada por supervisión'))).toBe('venta-inexistente');
    await solicitarAnulacion(e.deps, T, caj, UUID(1), 'x');
    await solicitarAnulacion(e.deps, T, sup, UUID(1), 'otra'); // no pisa la solicitud original
  });

  it('un reembolso en efectivo mayor al efectivo de la caja se rechaza y no cambia nada', async () => {
    const e = crearEntorno();
    await abrir(e, caj, { BOB: 0 });
    await venderP1(e, 1);
    await cerrarTurno(e.deps, T, caj, TURNO, { BOB: 7000 });
    await abrirTurno(e.deps, T, caj2, UUID(901), { BOB: 1000 });
    await solicitarAnulacion(e.deps, T, caj, UUID(1), 'x');
    expect(await codigo(aprobarAnulacion(e.deps, T, sup, UUID(1), 'aprobada por supervisión'))).toBe('egreso-excede-efectivo');
    expect(stock(e, 'tienda', 'p1')).toBe(9);
    expect(eventos(e, 'venta.anulada')).toHaveLength(0);
    // Con un ingreso justificado que complete el efectivo, la anulación procede.
    await registrarMovimientoCaja(e.deps, T, sup, UUID(70), { tipo: 'ingreso', moneda: 'BOB', monto: 6000, motivo: 'fondo' });
    const r = await aprobarAnulacion(e.deps, T, sup, UUID(1), 'aprobada por supervisión');
    expect(r.reembolsos).toEqual([{ medio: 'efectivo', moneda: 'BOB', monto: 7000 }]);
  });

  it('venta mixta efectivo + QR: devuelve cada parte por su medio; el QR no resta del efectivo y el arqueo cuadra', async () => {
    const e = crearEntorno();
    await abrir(e, caj, { BOB: 0 });
    // Total 14000: 9000 en efectivo (pagó 10000, cambio 1000) y 5000 por QR.
    await confirmarVenta(e.deps, T, caj, UUID(1), carritoP1(2), [
      efectivo(10000, 1000),
      { medio: 'qr', moneda: 'BOB', monto: 5000, referencia: 'REF-1' },
    ]);
    await solicitarAnulacion(e.deps, T, caj, UUID(1), 'devolución');
    const r = await aprobarAnulacion(e.deps, T, sup, UUID(1), 'aprobada por supervisión');
    expect(r.reembolsos).toEqual([
      { medio: 'efectivo', moneda: 'BOB', monto: 9000 },
      { medio: 'qr', moneda: 'BOB', monto: 5000 },
    ]);
    const ev = eventos(e, 'venta.anulada');
    expect(validarEvento(ev[0]).ok).toBe(true);
    expect((ev[0]?.['datos'] as { reembolsos: unknown }).reembolsos).toEqual(r.reembolsos);
    const turno = e.db.dato(`tenants/${T}/turnos/${TURNO}`) as { totales: { BOB: Record<string, number> } };
    expect(turno.totales.BOB).toMatchObject({ efectivo: 0, qr: 0 });
    expect(e.db.dato(`tenants/${T}/anulaciones/${UUID(1)}`)).toMatchObject({ reembolsos: r.reembolsos });
    const ops = {
      ventas: e.db.coleccion(`tenants/${T}/ventas`) as never,
      cobrosCredito: [],
      movimientos: [],
      anulaciones: e.db.coleccion(`tenants/${T}/anulaciones`) as never,
    };
    expect(reconstruirTotales(TURNO, ops)).toEqual(turno.totales);
    const cierre = await cerrarTurno(e.deps, T, caj, TURNO, { BOB: 0 });
    expect(JSON.stringify(cierre)).toContain('"diferencia":0');
  });

  it('en un turno distinto, el QR devuelto no toca el efectivo y el efectivo sale solo de la caja de esa moneda', async () => {
    const e = crearEntorno();
    await abrir(e, caj, { BOB: 0 });
    await confirmarVenta(e.deps, T, caj, UUID(1), carritoP1(2), [efectivo(9000), { medio: 'qr', moneda: 'BOB', monto: 5000, referencia: 'R' }]);
    await cerrarTurno(e.deps, T, caj, TURNO, { BOB: 9000 });
    await abrirTurno(e.deps, T, caj2, UUID(901), { BOB: 9000, USD: 50000 });
    await solicitarAnulacion(e.deps, T, caj, UUID(1), 'x');
    await aprobarAnulacion(e.deps, T, sup, UUID(1), 'aprobada por supervisión');
    const t = e.db.dato(`tenants/${T}/turnos/${UUID(901)}`) as { totales: { BOB: Record<string, number>; USD?: unknown } };
    expect(t.totales.BOB).toMatchObject({ efectivo: -9000, qr: -5000, transferencia: 0 });
    expect(t.totales.USD).toBeUndefined();
  });

  it('un crédito parcialmente cobrado reembolsa también los cobros, por el medio con que se cobraron', async () => {
    const e = crearEntorno();
    await abrir(e, sup, { BOB: 0 });
    await confirmarVenta(e.deps, T, sup, UUID(1), carritoP1(1, { cliente: { nombre: 'Ana' } }), [
      efectivo(2000),
      { medio: 'credito', moneda: 'BOB', monto: 5000 },
    ]);
    await cobrarCredito(e.deps, T, sup, UUID(2), UUID(1), { medio: 'qr', monto: 1500, referencia: 'R1' });
    await cobrarCredito(e.deps, T, sup, UUID(3), UUID(1), { medio: 'efectivo', monto: 500 });
    await solicitarAnulacion(e.deps, T, sup, UUID(1), 'x');
    const r = await aprobarAnulacion(e.deps, T, adm, UUID(1), 'aprobada por supervisión');
    expect(r.reembolsos).toEqual([
      { medio: 'efectivo', moneda: 'BOB', monto: 2500 },
      { medio: 'qr', moneda: 'BOB', monto: 1500 },
    ]);
    expect(validarEvento(eventos(e, 'venta.anulada')[0]).ok).toBe(true);
    const turno = e.db.dato(`tenants/${T}/turnos/${TURNO}`) as { totales: { BOB: Record<string, number> } };
    expect(turno.totales.BOB).toMatchObject({ efectivo: 0, qr: 0, credito: 0 });
  });

  it('anular una venta a crédito cancela el saldo y reembolsa solo lo cobrado', async () => {
    const e = crearEntorno();
    await abrir(e, sup, { BOB: 0 });
    const pagos = [efectivo(2000), { medio: 'credito' as const, moneda: 'BOB' as const, monto: 5000 }];
    await confirmarVenta(e.deps, T, sup, UUID(1), carritoP1(1, { cliente: { nombre: 'Ana' } }), pagos);
    await solicitarAnulacion(e.deps, T, sup, UUID(1), 'x');
    const r = await aprobarAnulacion(e.deps, T, adm, UUID(1), 'aprobada por supervisión');
    expect(r.reembolsos).toEqual([{ medio: 'efectivo', moneda: 'BOB', monto: 2000 }]);
    expect(e.db.dato(`tenants/${T}/creditos/${UUID(1)}`)).toMatchObject({ estado: 'anulado', saldo: 0 });
    const turno = e.db.dato(`tenants/${T}/turnos/${TURNO}`) as { totales: { BOB: { efectivo: number; credito: number } } };
    expect(turno.totales.BOB).toMatchObject({ efectivo: 0, credito: 0 });
    expect(validarEvento(eventos(e, 'venta.anulada')[0]).ok).toBe(true);
  });

  it('una venta íntegramente a crédito sin cobros reembolsa cero', async () => {
    const e = crearEntorno();
    await abrir(e, sup, { BOB: 0 });
    await confirmarVenta(e.deps, T, sup, UUID(1), carritoP1(1, { cliente: { nombre: 'Ana' } }), [{ medio: 'credito', moneda: 'BOB', monto: 7000 }]);
    await solicitarAnulacion(e.deps, T, sup, UUID(1), 'x');
    const r = await aprobarAnulacion(e.deps, T, adm, UUID(1), 'aprobada por supervisión');
    expect(r.reembolsos).toEqual([]);
    expect(validarEvento(eventos(e, 'venta.anulada')[0]).ok).toBe(true);
  });
});
