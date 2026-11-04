import {
  cobrarCredito, confirmarVenta, ErrorPos, guardarConfigPos, registrarMovimientoCaja, resolverAprobacion, solicitarAprobacion, validarConfigPos,
  CONFIG_POS_POR_DEFECTO, leerConfigPos, cerrarTurno,
} from '@plataforma/pos';
import { describe, expect, it } from 'vitest';
import { T, TURNO, UUID, abrir, adm, auditoria, caj, caj2, carritoP1, crearEntorno, sup, venderP1 } from './ayudas.js';

const codigo = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    return e instanceof ErrorPos ? e.codigo : `otro:${String(e)}`;
  }
  return 'sin-error';
};

describe('ingresos y egresos', () => {
  const mov = (tipo: 'ingreso' | 'egreso', monto: number, moneda: 'BOB' | 'USD' | 'ARS' = 'BOB') => ({ tipo, moneda, monto, motivo: 'justificado' });

  it('un egreso mayor al efectivo de esa moneda se rechaza en el servidor', async () => {
    const e = crearEntorno();
    await abrir(e, caj, { BOB: 10000, USD: 0 });
    expect(await codigo(registrarMovimientoCaja(e.deps, T, caj, UUID(70), mov('egreso', 10001)))).toBe('egreso-excede-efectivo');
    expect(await codigo(registrarMovimientoCaja(e.deps, T, caj, UUID(71), mov('egreso', 1, 'USD')))).toBe('egreso-excede-efectivo');
    await registrarMovimientoCaja(e.deps, T, caj, UUID(72), mov('egreso', 10000));
    expect(await codigo(registrarMovimientoCaja(e.deps, T, caj, UUID(73), mov('egreso', 1)))).toBe('egreso-excede-efectivo');
    await registrarMovimientoCaja(e.deps, T, caj, UUID(74), mov('ingreso', 500));
    await registrarMovimientoCaja(e.deps, T, caj, UUID(75), mov('egreso', 500));
  });

  it('el efectivo vendido habilita egresos; QR y crédito no', async () => {
    const e = crearEntorno();
    await abrir(e, caj, { BOB: 0 });
    await confirmarVenta(e.deps, T, caj, UUID(1), carritoP1(), [{ medio: 'qr', moneda: 'BOB', monto: 7000, referencia: 'r' }]);
    expect(await codigo(registrarMovimientoCaja(e.deps, T, caj, UUID(70), mov('egreso', 1)))).toBe('egreso-excede-efectivo');
    await venderP1(e, 2);
    await registrarMovimientoCaja(e.deps, T, caj, UUID(71), mov('egreso', 7000));
  });

  it('es idempotente, exige motivo y turno, y respeta al dueño del turno', async () => {
    const e = crearEntorno();
    expect(await codigo(registrarMovimientoCaja(e.deps, T, caj, UUID(70), mov('ingreso', 1)))).toBe('sin-turno');
    await abrir(e, caj, { BOB: 0 });
    const a = await registrarMovimientoCaja(e.deps, T, caj, UUID(70), { ...mov('ingreso', 100), comprobante: 'REC-1' });
    const b = await registrarMovimientoCaja(e.deps, T, caj, UUID(70), mov('ingreso', 100));
    expect([a.repetido, b.repetido]).toEqual([false, true]);
    const turno = e.db.dato(`tenants/${T}/turnos/${TURNO}`) as { totales: { BOB: { ingresos: number } } };
    expect(turno.totales.BOB.ingresos).toBe(100);
    expect(await codigo(registrarMovimientoCaja(e.deps, T, sup, UUID(70), mov('ingreso', 100)))).toBe('request-en-uso');
    expect(await codigo(registrarMovimientoCaja(e.deps, T, caj, UUID(71), { ...mov('ingreso', 1), motivo: ' ' }))).toBe('entrada-invalida');
    expect(await codigo(registrarMovimientoCaja(e.deps, T, caj, UUID(71), mov('ingreso', 0)))).toBe('entrada-invalida');
    expect(await codigo(registrarMovimientoCaja(e.deps, T, caj, UUID(71), { ...mov('ingreso', 1), tipo: 'x' as never }))).toBe('entrada-invalida');
    expect(await codigo(registrarMovimientoCaja(e.deps, T, caj, UUID(71), { ...mov('ingreso', 1), moneda: 'EUR' as never }))).toBe('entrada-invalida');
    expect(await codigo(registrarMovimientoCaja(e.deps, T, caj2, UUID(71), mov('ingreso', 1)))).toBe('turno-ajeno');
    await registrarMovimientoCaja(e.deps, T, sup, UUID(72), mov('ingreso', 1));
    expect(auditoria(e).filter((x) => x['accion'] === 'pos.caja.ingreso')).toHaveLength(2);
  });
});

describe('créditos', () => {
  const pagos = (monto: number) => [{ medio: 'credito' as const, moneda: 'BOB' as const, monto }];

  it('el cajero necesita aprobación de crédito de un supervisor; exige nombre del deudor', async () => {
    const e = crearEntorno();
    await abrir(e, caj, { BOB: 0 });
    const c = carritoP1(1, { cliente: { nombre: 'Ana' } });
    expect(await codigo(confirmarVenta(e.deps, T, caj, UUID(1), c, pagos(7000)))).toBe('aprobacion-inexistente');
    expect(await codigo(confirmarVenta(e.deps, T, caj, UUID(1), carritoP1(), pagos(7000)))).toBe('pagos-invalidos');
    await solicitarAprobacion(e.deps, T, caj, UUID(50), { tipo: 'credito', moneda: 'BOB', monto: 7000, motivo: 'cliente conocido', deudor: 'Ana' });
    await resolverAprobacion(e.deps, T, sup, UUID(50), 'aprobar');
    expect(await codigo(confirmarVenta(e.deps, T, caj, UUID(1), carritoP1(1, { cliente: { nombre: 'Otra' } }), pagos(7000), undefined, UUID(50)))).toBe('aprobacion-no-coincide');
    const r = await confirmarVenta(e.deps, T, caj, UUID(1), c, pagos(7000), undefined, UUID(50));
    expect(r.venta.total).toBe(7000);
    expect(e.db.dato(`tenants/${T}/creditos/${UUID(1)}`)).toMatchObject({ deudor: 'Ana', saldo: 7000, aprobadoPor: 'u-sup', estado: 'pendiente' });
    expect(await codigo(confirmarVenta(e.deps, T, caj, UUID(2), c, pagos(7000), undefined, UUID(50)))).toBe('aprobacion-usada');
  });

  it('cobro posterior: parcial y total, entra al turno donde se cobra y suma al efectivo', async () => {
    const e = crearEntorno();
    await abrir(e, sup, { BOB: 0 });
    await confirmarVenta(e.deps, T, sup, UUID(1), carritoP1(1, { cliente: { nombre: 'Ana' } }), pagos(7000));
    const a = await cobrarCredito(e.deps, T, sup, UUID(80), UUID(1), { medio: 'efectivo', monto: 3000 });
    expect(a.repetido).toBe(false);
    expect((await cobrarCredito(e.deps, T, sup, UUID(80), UUID(1), { medio: 'efectivo', monto: 3000 })).repetido).toBe(true);
    expect(e.db.dato(`tenants/${T}/creditos/${UUID(1)}`)).toMatchObject({ saldo: 4000, cobrado: 3000, estado: 'pendiente' });
    await cobrarCredito(e.deps, T, sup, UUID(81), UUID(1), { medio: 'qr', monto: 4000, referencia: 'R1' });
    expect(e.db.dato(`tenants/${T}/creditos/${UUID(1)}`)).toMatchObject({ saldo: 0, estado: 'cobrado' });
    const turno = e.db.dato(`tenants/${T}/turnos/${TURNO}`) as { totales: { BOB: { efectivo: number; qr: number; credito: number } } };
    expect(turno.totales.BOB).toMatchObject({ efectivo: 3000, qr: 4000, credito: 7000 });
    const { arqueo } = await cerrarTurno(e.deps, T, sup, TURNO, { BOB: 3000 });
    expect(arqueo.BOB).toMatchObject({ esperado: 3000, diferencia: 0, qr: 4000, credito: 7000 });
  });

  it('rechaza cobros inválidos', async () => {
    const e = crearEntorno();
    await abrir(e, sup, { BOB: 0 });
    await confirmarVenta(e.deps, T, sup, UUID(1), carritoP1(1, { cliente: { nombre: 'Ana' } }), pagos(7000));
    const c = (id: number, v: string, x: Parameters<typeof cobrarCredito>[5]) => codigo(cobrarCredito(e.deps, T, sup, UUID(id), v, x));
    expect(await c(80, UUID(1), { medio: 'efectivo', monto: 7001 })).toBe('credito-saldo-insuficiente');
    expect(await c(80, UUID(2), { medio: 'efectivo', monto: 1 })).toBe('credito-inexistente');
    expect(await c(80, UUID(1), { medio: 'qr', monto: 1 })).toBe('pagos-invalidos');
    expect(await c(80, UUID(1), { medio: 'credito' as never, monto: 1 })).toBe('entrada-invalida');
    expect(await c(80, UUID(1), { medio: 'efectivo', monto: 0 })).toBe('entrada-invalida');
    await cobrarCredito(e.deps, T, sup, UUID(81), UUID(1), { medio: 'efectivo', monto: 100 });
    expect(await codigo(cobrarCredito(e.deps, T, caj, UUID(81), UUID(1), { medio: 'efectivo', monto: 100 }))).toBe('request-en-uso');
    expect(await codigo(cobrarCredito(e.deps, T, caj, UUID(82), UUID(1), { medio: 'efectivo', monto: 100 }))).toBe('turno-ajeno');
  });

  it('sin turno abierto no se cobra', async () => {
    const e = crearEntorno();
    await abrir(e, sup, { BOB: 0 });
    await confirmarVenta(e.deps, T, sup, UUID(1), carritoP1(1, { cliente: { nombre: 'Ana' } }), pagos(7000));
    await cerrarTurno(e.deps, T, sup, TURNO, { BOB: 0 });
    expect(await codigo(cobrarCredito(e.deps, T, sup, UUID(80), UUID(1), { medio: 'efectivo', monto: 100 }))).toBe('sin-turno');
  });
});

describe('configuración del POS', () => {
  const valida = {
    negocio: { nombre: 'Tienda', direccion: 'Calle 1' },
    logoUrl: 'https://ejemplo.test/logo.png',
    colores: { primario: '#112233', secundario: '#ffffff' },
    mediosHabilitados: ['efectivo', 'qr'],
    monedaPorDefecto: 'USD',
    topesDescuentoBp: { caj: 500, sup: 2000, adm: 5000 },
    textoRecibo: 'Gracias',
    serieRecibo: 'B',
  };

  it('solo el administrador la guarda; queda auditada y se lee', async () => {
    const e = crearEntorno();
    expect(await codigo(guardarConfigPos(e.deps, T, sup, valida))).toBe('no-autorizado');
    await guardarConfigPos(e.deps, T, adm, valida);
    expect(auditoria(e).some((x) => x['accion'] === 'pos.config.guardar')).toBe(true);
    const cfg = await e.db.runTransaction((tx) => leerConfigPos(tx, T));
    expect(cfg.serieRecibo).toBe('B');
    expect(cfg.topesDescuentoBp.caj).toBe(500);
  });

  it('sin configuración rigen los valores iniciales, con 5 % para el vendedor', async () => {
    const e = crearEntorno();
    expect((await e.db.runTransaction((tx) => leerConfigPos(tx, T))).topesDescuentoBp.caj).toBe(500);
    expect(CONFIG_POS_POR_DEFECTO.mediosHabilitados).toContain('efectivo');
  });

  it('una configuración guardada inválida es dato corrupto', async () => {
    const e = crearEntorno();
    e.db.poner(`tenants/${T}/pos_config/main`, { config: { x: 1 } });
    expect(await codigo(e.db.runTransaction((tx) => leerConfigPos(tx, T)))).toBe('dato-corrupto');
  });

  it('rechaza entradas inválidas', () => {
    const mal = (cambio: Record<string, unknown>) => () => validarConfigPos({ ...valida, ...cambio });
    expect(mal({ logoUrl: 'javascript:alert(1)' })).toThrow(ErrorPos);
    expect(mal({ logoUrl: 'http://x.test/a.png' })).toThrow(ErrorPos);
    expect(mal({ colores: { primario: 'rojo', secundario: '#ffffff' } })).toThrow(ErrorPos);
    expect(mal({ mediosHabilitados: [] })).toThrow(ErrorPos);
    expect(mal({ mediosHabilitados: ['efectivo', 'efectivo'] })).toThrow(ErrorPos);
    expect(mal({ mediosHabilitados: ['cheque'] })).toThrow(ErrorPos);
    expect(mal({ monedaPorDefecto: 'EUR' })).toThrow(ErrorPos);
    expect(mal({ topesDescuentoBp: { caj: 10001, sup: 0, adm: 0 } })).toThrow(ErrorPos);
    expect(mal({ topesDescuentoBp: { caj: 5.5, sup: 0, adm: 0 } })).toThrow(ErrorPos);
    expect(mal({ serieRecibo: 'a b' })).toThrow(ErrorPos);
    expect(mal({ textoRecibo: 'x'.repeat(501) })).toThrow(ErrorPos);
    expect(mal({ negocio: { nombre: '' } })).toThrow(ErrorPos);
    expect(mal({ negocio: { nombre: 'x', otro: 1 } })).toThrow(ErrorPos);
    expect(mal({ extra: 1 })).toThrow(ErrorPos);
    expect(() => validarConfigPos(null)).toThrow(ErrorPos);
  });
});
