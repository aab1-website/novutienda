import { LimiteDelPlan, validarEvento } from '@plataforma/nucleo';
import {
  abrirTurno, calcularArqueo, cerrarTurno, cerrarTurnoForzado, ErrorPos, proyectarTurno, registrarMovimientoCaja, reconstruirTotales,
} from '@plataforma/pos';
import { describe, expect, it } from 'vitest';
import { T, TURNO, UUID, abrir, adm, auditoria, caj, caj2, crearEntorno, eventos, sup, venderP1 } from './ayudas.js';

const codigo = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    return e instanceof ErrorPos ? e.codigo : `otro:${String(e)}`;
  }
  return 'sin-error';
};
const cajas = (e: ReturnType<typeof crearEntorno>) => (e.db.dato(`tenants/${T}/contadores/uso`) as { cajas?: number } | undefined)?.cajas;

describe('apertura', () => {
  it('abre con efectivo por moneda, reserva la caja y es idempotente', async () => {
    const e = crearEntorno();
    const t = await abrir(e, caj, { BOB: 10000, USD: 500 });
    expect(t).toMatchObject({ estado: 'abierto', cajeroUid: 'u-caj', cajaId: 'caja-1' });
    expect(cajas(e)).toBe(1);
    await abrir(e, caj, { BOB: 10000, USD: 500 });
    expect(cajas(e)).toBe(1);
    expect(await codigo(abrir(e, caj2, { BOB: 1 }))).toBe('request-en-uso');
  });
  it('segundo turno con caja ocupada: puntero y cupo', async () => {
    const e = crearEntorno();
    await abrir(e);
    expect(await codigo(abrir(e, caj2, { BOB: 0 }, UUID(901)))).toBe('turno-ya-abierto');
    expect(cajas(e)).toBe(1);
    e.db.poner(`tenants/${T}/pos_config/turno_activo`, undefined);
    await expect(abrir(e, caj2, { BOB: 0 }, UUID(902))).rejects.toBeInstanceOf(LimiteDelPlan);
  });
  it('valida la apertura', async () => {
    const e = crearEntorno();
    for (const mal of [{}, { EUR: 1 }, { BOB: -1 }, { BOB: 1.5 }, 'x', null]) {
      expect(await codigo(abrirTurno(e.deps, T, caj, TURNO, mal))).toBe('entrada-invalida');
    }
    expect(await codigo(abrirTurno(e.deps, T, caj, 'x', { BOB: 1 }))).toBe('entrada-invalida');
  });
});

describe('cierre y arqueo', () => {
  it('esperado = apertura + efectivo neto + ingresos − egresos; QR y crédito no suman; publica turno.cerrado', async () => {
    const e = crearEntorno();
    await abrir(e, caj, { BOB: 10000 });
    await venderP1(e, 1); // +7000 efectivo
    await registrarMovimientoCaja(e.deps, T, caj, UUID(70), { tipo: 'ingreso', moneda: 'BOB', monto: 2000, motivo: 'cambio chico' });
    await registrarMovimientoCaja(e.deps, T, caj, UUID(71), { tipo: 'egreso', moneda: 'BOB', monto: 500, motivo: 'taxi' });
    const { turno, arqueo } = await cerrarTurno(e.deps, T, caj, TURNO, { BOB: 18500 });
    expect(arqueo.BOB).toMatchObject({ apertura: 10000, esperado: 18500, contado: 18500, diferencia: 0, efectivo: 7000 });
    expect(turno.estado).toBe('cerrado');
    const ev = eventos(e, 'turno.cerrado');
    expect(ev).toHaveLength(1);
    expect(validarEvento(ev[0]).ok).toBe(true);
    expect(cajas(e)).toBe(0);
    expect(e.db.dato(`tenants/${T}/pos_config/turno_activo`)).toBeUndefined();
  });

  it('la diferencia negativa NO se tapa en cero', async () => {
    const e = crearEntorno();
    await abrir(e, caj, { BOB: 10000 });
    const { arqueo, turno } = await cerrarTurno(e.deps, T, caj, TURNO, { BOB: 9500 });
    expect(arqueo.BOB?.diferencia).toBe(-500);
    expect(turno.diferencia?.BOB).toBe(-500);
    const sobrante = crearEntorno();
    await abrir(sobrante, caj, { BOB: 10000 });
    expect((await cerrarTurno(sobrante.deps, T, caj, TURNO, { BOB: 10200 })).arqueo.BOB?.diferencia).toBe(200);
  });

  it('exige el conteo de cada moneda con movimiento y rechaza conteos inválidos', async () => {
    const e = crearEntorno();
    await abrir(e, caj, { BOB: 100, USD: 0 });
    expect(await codigo(cerrarTurno(e.deps, T, caj, TURNO, { BOB: 100 }))).toBe('conteo-faltante');
    expect(await codigo(cerrarTurno(e.deps, T, caj, TURNO, { BOB: -1, USD: 0 }))).toBe('entrada-invalida');
    expect(await codigo(cerrarTurno(e.deps, T, caj, TURNO, { BOB: 100, USD: 0, EUR: 1 }))).toBe('entrada-invalida');
    expect(cajas(e)).toBe(1);
  });

  it('cierra solo si está abierto: un doble cierre no libera el cupo de otro turno', async () => {
    const e = crearEntorno();
    await abrir(e, caj, { BOB: 0 });
    await cerrarTurno(e.deps, T, caj, TURNO, { BOB: 0 });
    await abrir(e, caj2, { BOB: 0 }, UUID(901));
    expect(cajas(e)).toBe(1);
    expect(await codigo(cerrarTurno(e.deps, T, caj, TURNO, { BOB: 0 }))).toBe('turno-no-abierto');
    expect(await codigo(cerrarTurnoForzado(e.deps, T, adm, TURNO, { BOB: 0 }, 'x'))).toBe('turno-no-abierto');
    expect(cajas(e)).toBe(1);
    expect(eventos(e, 'turno.cerrado')).toHaveLength(1);
    // el turno nuevo sigue siendo el activo
    expect(e.db.dato(`tenants/${T}/pos_config/turno_activo`)).toMatchObject({ turnoId: UUID(901) });
  });

  it('dos cierres simultáneos liberan el cupo una sola vez', async () => {
    const e = crearEntorno();
    await abrir(e, caj, { BOB: 0 });
    const r = await Promise.allSettled([cerrarTurno(e.deps, T, caj, TURNO, { BOB: 0 }), cerrarTurno(e.deps, T, caj, TURNO, { BOB: 0 })]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(cajas(e)).toBe(0);
  });

  it('otro cajero no cierra el turno; turno inexistente', async () => {
    const e = crearEntorno();
    await abrir(e, caj, { BOB: 0 });
    expect(await codigo(cerrarTurno(e.deps, T, caj2, TURNO, { BOB: 0 }))).toBe('turno-ajeno');
    expect(await codigo(cerrarTurno(e.deps, T, caj, UUID(1), { BOB: 0 }))).toBe('sin-turno');
  });
});

describe('cierre forzado', () => {
  it('solo adm, con motivo, con la misma fórmula', async () => {
    const e = crearEntorno();
    await abrir(e, caj, { BOB: 10000 });
    await venderP1(e, 1);
    expect(await codigo(cerrarTurnoForzado(e.deps, T, sup, TURNO, { BOB: 17000 }, 'm'))).toBe('no-autorizado');
    expect(await codigo(cerrarTurnoForzado(e.deps, T, caj, TURNO, { BOB: 17000 }, 'm'))).toBe('no-autorizado');
    expect(await codigo(cerrarTurnoForzado(e.deps, T, adm, TURNO, { BOB: 17000 }, ' '))).toBe('entrada-invalida');
    const r = await cerrarTurnoForzado(e.deps, T, adm, TURNO, { BOB: 16000 }, 'el cajero se fue');
    expect(r.turno.estado).toBe('cerrado_forzado');
    expect(r.arqueo.BOB).toMatchObject({ esperado: 17000, diferencia: -1000 });
    expect(cajas(e)).toBe(0);
    expect(auditoria(e).some((a) => a['accion'] === 'pos.turno.cerrar_forzado' && a['motivo'] === 'el cajero se fue')).toBe(true);
  });
});

describe('supervisión en vivo', () => {
  it('proyecta efectivo esperado y medios por moneda; coincide con la reconstrucción desde las operaciones', async () => {
    const e = crearEntorno();
    await abrir(e, caj, { BOB: 10000, USD: 100 });
    await venderP1(e, 1, caj, 2);
    await registrarMovimientoCaja(e.deps, T, caj, UUID(70), { tipo: 'egreso', moneda: 'USD', monto: 40, motivo: 'm' });
    const turno = e.db.dato(`tenants/${T}/turnos/${TURNO}`) as never;
    const p = proyectarTurno(turno);
    expect(p.BOB).toMatchObject({ apertura: 10000, efectivoEsperado: 24000, qr: 0 });
    expect(p.USD).toMatchObject({ efectivoEsperado: 60, egresos: 40 });
    expect(p.ARS).toBeUndefined();
    const ops = {
      ventas: e.db.coleccion(`tenants/${T}/ventas`) as never,
      cobrosCredito: [],
      movimientos: e.db.coleccion(`tenants/${T}/movimientos_caja`) as never,
      anulaciones: [],
    };
    expect(reconstruirTotales(TURNO, ops)).toEqual((turno as { totales: unknown }).totales);
  });

  it('calcularArqueo no ata la diferencia a cero aunque no haya movimientos', () => {
    const a = calcularArqueo({ apertura: { BOB: 100 }, totales: {} }, { BOB: 0 });
    expect(a.BOB?.diferencia).toBe(-100);
  });
});
