import { validarEvento } from '@plataforma/nucleo';
import {
  abrirTurno, aprobarAnulacion, cerrarTurno, confirmarVenta, ErrorPos, reconstruirTotales, solicitarAnulacion,
} from '@plataforma/pos';
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
    const r = await aprobarAnulacion(e.deps, T, sup, UUID(1), 'efectivo');
    expect(r.reembolso).toEqual({ medio: 'efectivo', moneda: 'BOB', monto: 14000 });
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
    const r = await aprobarAnulacion(e.deps, T, adm, UUID(1), 'efectivo');
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
    await aprobarAnulacion(e.deps, T, sup, UUID(1), 'efectivo');
    expect(await codigo(aprobarAnulacion(e.deps, T, adm, UUID(1), 'efectivo'))).toBe('venta-ya-anulada');
    expect(await codigo(solicitarAnulacion(e.deps, T, caj, UUID(1), 'otra'))).toBe('venta-ya-anulada');
    expect(stock(e, 'tienda', 'p1')).toBe(10);
    expect(eventos(e, 'venta.anulada')).toHaveLength(1);
  });

  it('dos aprobaciones simultáneas anulan una sola vez', async () => {
    const e = crearEntorno();
    await abrir(e);
    await venderP1(e, 1);
    await solicitarAnulacion(e.deps, T, caj, UUID(1), 'x');
    const r = await Promise.allSettled([aprobarAnulacion(e.deps, T, sup, UUID(1), 'efectivo'), aprobarAnulacion(e.deps, T, adm, UUID(1), 'efectivo')]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(stock(e, 'tienda', 'p1')).toBe(10);
  });

  it('el vendedor no aprueba; sin solicitud no se aprueba; sin turno abierto no hay reembolso', async () => {
    const e = crearEntorno();
    await abrir(e);
    await venderP1(e, 1);
    expect(await codigo(aprobarAnulacion(e.deps, T, caj, UUID(1), 'efectivo'))).toBe('no-autorizado');
    expect(await codigo(aprobarAnulacion(e.deps, T, sup, UUID(1), 'efectivo'))).toBe('anulacion-sin-solicitud');
    await solicitarAnulacion(e.deps, T, caj, UUID(1), 'x');
    await cerrarTurno(e.deps, T, caj, TURNO, { BOB: 17000 });
    expect(await codigo(aprobarAnulacion(e.deps, T, sup, UUID(1), 'efectivo'))).toBe('sin-turno');
    expect(stock(e, 'tienda', 'p1')).toBe(9);
  });

  it('el vendedor solo solicita sobre sus ventas; faltan datos', async () => {
    const e = crearEntorno();
    await abrir(e);
    await venderP1(e, 1);
    expect(await codigo(solicitarAnulacion(e.deps, T, caj2, UUID(1), 'x'))).toBe('no-autorizado');
    expect(await codigo(solicitarAnulacion(e.deps, T, caj, UUID(1), ' '))).toBe('entrada-invalida');
    expect(await codigo(solicitarAnulacion(e.deps, T, caj, UUID(2), 'x'))).toBe('venta-inexistente');
    expect(await codigo(aprobarAnulacion(e.deps, T, sup, UUID(2), 'efectivo'))).toBe('venta-inexistente');
    await solicitarAnulacion(e.deps, T, caj, UUID(1), 'x');
    await solicitarAnulacion(e.deps, T, sup, UUID(1), 'otra'); // no pisa la solicitud original
    expect(await codigo(aprobarAnulacion(e.deps, T, sup, UUID(1)))).toBe('entrada-invalida');
    expect(await codigo(aprobarAnulacion(e.deps, T, sup, UUID(1), 'credito'))).toBe('entrada-invalida');
  });

  it('un reembolso en efectivo mayor al efectivo de la caja se rechaza', async () => {
    const e = crearEntorno();
    await abrir(e, caj, { BOB: 0 });
    await venderP1(e, 1);
    await cerrarTurno(e.deps, T, caj, TURNO, { BOB: 7000 });
    await abrirTurno(e.deps, T, caj2, UUID(901), { BOB: 1000 });
    await solicitarAnulacion(e.deps, T, caj, UUID(1), 'x');
    expect(await codigo(aprobarAnulacion(e.deps, T, sup, UUID(1), 'efectivo'))).toBe('egreso-excede-efectivo');
    const r = await aprobarAnulacion(e.deps, T, sup, UUID(1), 'transferencia');
    expect(r.reembolso.medio).toBe('transferencia');
    const turno = e.db.dato(`tenants/${T}/turnos/${UUID(901)}`) as { totales: { BOB: { transferencia: number; efectivo: number } } };
    expect(turno.totales.BOB).toMatchObject({ transferencia: -7000, efectivo: 0 });
  });

  it('anular una venta a crédito cancela el saldo y reembolsa solo lo cobrado', async () => {
    const e = crearEntorno();
    await abrir(e, sup, { BOB: 0 });
    const pagos = [efectivo(2000), { medio: 'credito' as const, moneda: 'BOB' as const, monto: 5000 }];
    await confirmarVenta(e.deps, T, sup, UUID(1), carritoP1(1, { cliente: { nombre: 'Ana' } }), pagos);
    await solicitarAnulacion(e.deps, T, sup, UUID(1), 'x');
    const r = await aprobarAnulacion(e.deps, T, adm, UUID(1), 'efectivo');
    expect(r.reembolso.monto).toBe(2000);
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
    const r = await aprobarAnulacion(e.deps, T, adm, UUID(1));
    expect(r.reembolso).toEqual({ medio: 'credito', moneda: 'BOB', monto: 0 });
    expect(validarEvento(eventos(e, 'venta.anulada')[0]).ok).toBe(true);
  });
});

