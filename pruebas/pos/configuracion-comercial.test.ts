// La caja usa la configuración comercial del comercio: mercados, monedas de caja, precio por mercado y orden de monedas.
// El tenant de referencia (BOB, USD, ARS; mercados BO y AR con base USD) debe quedar idéntico al comportamiento anterior.
import { aCentavos, precioFinal, type ConfiguracionComercial, type MercadoTenant, type RedondeoPorMoneda } from '@novutienda/nucleo';
import {
  abrirTurno, aprobarAnulacion, calcularArqueo, centavosDeLinea, cerrarTurno, cerrarTurnoForzado, cobrarCredito, configPosPorDefecto, confirmarVenta, ErrorPos, guardarConfigPos,
  leerConfigPos, proyectarTurno, registrarMovimientoCaja, solicitarAnulacion, solicitarAprobacion, validarConfigPos, type Carrito,
} from '@novutienda/pos';
import { describe, expect, it } from 'vitest';
import { COMERCIAL_REFERENCIA, T, TURNO, UUID, abrir, adm, caj, crearEntorno, eventos, sup, venderP1, type Entorno } from './ayudas.js';

const error = async (p: Promise<unknown>): Promise<ErrorPos | undefined> => {
  try {
    await p;
  } catch (e) {
    return e instanceof ErrorPos ? e : undefined;
  }
  return undefined;
};
const codigo = async (p: Promise<unknown>): Promise<string> => (await error(p))?.codigo ?? 'sin-error';

const REGLA2 = { tipo: 'decimales', decimales: 2, modo: 'cercano' } as const;
const BO: MercadoTenant = COMERCIAL_REFERENCIA.mercados[0] as MercadoTenant;
/** Comercio v1 de un solo mercado con tipo de cambio (solo Bolivia, en BOB y USD). */
const SOLO_BO: ConfiguracionComercial = { mercados: [BO], monedas: ['BOB', 'USD'] };
/** Comercio de una sola moneda, sin tipo de cambio (ficticio): no cabe en la versión 1 de los eventos. */
const SOLO_CL: ConfiguracionComercial = {
  mercados: [{ id: 'CL', nombre: 'Chile', monedaVenta: 'CLP', monedaBase: 'CLP', zonaHoraria: 'America/Santiago', tipoCambio: null, redondeo: { tipo: 'multiplo', multiplo: 10, modo: 'cercano' } }],
  monedas: ['CLP'],
};
/** Dos mercados ficticios con tipo de cambio manual (no caben en la versión 1). */
const CL_PE: ConfiguracionComercial = {
  mercados: [
    SOLO_CL.mercados[0] as MercadoTenant,
    { id: 'PE', nombre: 'Perú', monedaVenta: 'PEN', monedaBase: 'USD', zonaHoraria: 'America/Lima', tipoCambio: { par: 'PEN/USD', fuentes: ['manual'] }, redondeo: REGLA2 },
  ],
  monedas: ['CLP', 'PEN', 'USD'],
};

const con = (e: Entorno, comercial: ConfiguracionComercial) => ({ ...e.deps, comercial });
const pagoEfectivo = (moneda: string, monto: number) => [{ medio: 'efectivo' as const, moneda, monto }];
const carrito = (mercado: string, moneda: string, productoId = 'p1'): Carrito => ({ mercado, moneda, lineas: [{ productoId, cantidad: 1 }] });

describe('validación del mercado y la moneda contra la configuración del comercio', () => {
  it('rechaza un mercado que el comercio no declara', async () => {
    const e = crearEntorno();
    await abrir(e);
    const d = con(e, SOLO_BO);
    expect(await codigo(confirmarVenta(d, T, caj, UUID(1), carrito('AR', 'ARS'), pagoEfectivo('ARS', 1)))).toBe('entrada-invalida');
    expect(await codigo(confirmarVenta(d, T, caj, UUID(2), carrito('XX', 'BOB'), pagoEfectivo('BOB', 1)))).toBe('entrada-invalida');
  });
  it('rechaza una moneda que el comercio no declara para la caja', async () => {
    const e = crearEntorno();
    await abrir(e);
    const d = con(e, SOLO_BO);
    expect(await codigo(confirmarVenta(d, T, caj, UUID(1), carrito('BO', 'ARS'), pagoEfectivo('ARS', 1)))).toBe('entrada-invalida');
    expect(await codigo(confirmarVenta(d, T, caj, UUID(2), carrito('BO', 'EUR'), pagoEfectivo('EUR', 1)))).toBe('entrada-invalida');
    expect(e.db.dato(`tenants/${T}/ventas/${UUID(1)}`)).toBeUndefined();
  });
  it('D19: no se cobra una moneda en un mercado que no es el suyo, aunque el comercio la declare', async () => {
    const e = crearEntorno();
    await abrir(e, caj, { BOB: 0, USD: 0, ARS: 0 });
    expect(await codigo(confirmarVenta(e.deps, T, caj, UUID(1), carrito('BO', 'ARS'), pagoEfectivo('ARS', 1)))).toBe('entrada-invalida');
    expect(await codigo(confirmarVenta(e.deps, T, caj, UUID(2), carrito('AR', 'BOB'), pagoEfectivo('BOB', 1)))).toBe('entrada-invalida');
    // La moneda de venta y la base de cada mercado sí.
    for (const [i, [m, mo, monto]] of ([['BO', 'BOB', 7000], ['BO', 'USD', 1000], ['AR', 'ARS', 1000000], ['AR', 'USD', 1000]] as const).entries()) {
      const r = await confirmarVenta(e.deps, T, caj, UUID(10 + i), carrito(m, mo), pagoEfectivo(mo, monto));
      expect(r.venta).toMatchObject({ mercado: m, moneda: mo, total: monto });
    }
  });
  it('comercio v1 de un solo mercado con tipo de cambio: vende en su moneda y en la base', async () => {
    const e = crearEntorno();
    const d = con(e, SOLO_BO);
    await abrirTurno(d, T, caj, TURNO, { BOB: 0, USD: 0 });
    const r = await confirmarVenta(d, T, caj, UUID(1), carrito('BO', 'BOB'), pagoEfectivo('BOB', 7000));
    expect(r.venta.cotizacion?.par).toBe('BOB/USD');
    const u = await confirmarVenta(d, T, caj, UUID(2), carrito('BO', 'USD'), pagoEfectivo('USD', 1000));
    expect(u.venta.cotizacion).toBeNull();
    expect(eventos(e, 'venta.confirmada')).toHaveLength(2);
  });
  it('sin precio en el mercado: mensaje con el producto y el mercado', async () => {
    const e = crearEntorno();
    await abrir(e, caj, { BOB: 0, ARS: 0 });
    const err = await error(confirmarVenta(e.deps, T, caj, UUID(1), carrito('AR', 'ARS', 'p3'), pagoEfectivo('ARS', 1)));
    expect(err?.codigo).toBe('sin-precio');
    expect(err?.message).toBe('El producto «Producto p3» no tiene precio en Argentina; complételo en Inventarios');
  });
  it('precio base 0 es «a consultar», en la moneda de venta y en la base', async () => {
    const e = crearEntorno();
    await abrir(e, caj, { BOB: 0, USD: 0 });
    e.db.poner(`tenants/${T}/_productos/p0`, { productoId: 'p0', nombre: 'Cero', activo: true, controlaSeries: false, preciosBase: { BO: 0 } });
    for (const [i, mo] of ['BOB', 'USD'].entries()) {
      const err = await error(confirmarVenta(e.deps, T, caj, UUID(1 + i), carrito('BO', mo, 'p0'), pagoEfectivo(mo, 1)));
      expect(err?.codigo).toBe('sin-precio');
      expect(err?.message).toContain('a consultar');
    }
  });
});

describe('orden de errores del cierre', () => {
  it('un conteo con forma inválida se rechaza como entrada inválida sin leer el turno', async () => {
    const e = crearEntorno();
    for (const contado of [{ bob: 1 }, { BOBS: 1 }, { BOB: -1 }, { BOB: 1.5 }, []]) {
      expect(await codigo(cerrarTurno(e.deps, T, caj, TURNO, contado))).toBe('entrada-invalida');
    }
    expect(await codigo(cerrarTurno(e.deps, T, caj, TURNO, { BOB: 1 }))).toBe('sin-turno');
  });
});

describe('guardia temporal de la versión 2 de los eventos', () => {
  const NO_ADMITE = { codigo: 'entrada-invalida', message: 'La caja aún no admite la configuración de este comercio' };
  const instantanea = (e: Entorno) => JSON.stringify([e.db.coleccion(`tenants/${T}/eventos`), e.db.coleccion(`tenants/${T}/auditoria`), e.db.dato(`tenants/${T}/turnos/${TURNO}`), e.db.dato(`tenants/${T}/pos_config/turno_activo`)]);

  it('confirmar venta y cerrar turno (normal y forzado) se rechazan antes de escribir nada', async () => {
    const e = crearEntorno();
    await abrir(e);
    const antes = instantanea(e);
    for (const comercial of [SOLO_CL, CL_PE]) {
      const d = con(e, comercial);
      const v = await error(confirmarVenta(d, T, caj, UUID(1), carrito(comercial.mercados[0]?.id ?? '', comercial.monedas[0] ?? ''), pagoEfectivo(comercial.monedas[0] ?? '', 1)));
      expect(v).toMatchObject(NO_ADMITE);
      expect(await error(cerrarTurno(d, T, caj, TURNO, { BOB: 10000 }))).toMatchObject(NO_ADMITE);
      expect(await error(cerrarTurnoForzado(d, T, adm, TURNO, { BOB: 10000 }, 'motivo'))).toMatchObject(NO_ADMITE);
    }
    expect(e.db.dato(`tenants/${T}/ventas/${UUID(1)}`)).toBeUndefined();
    expect((e.db.dato(`tenants/${T}/turnos/${TURNO}`) as { estado: string }).estado).toBe('abierto');
    expect(instantanea(e)).toBe(antes);
  });

  it('abrir un turno se rechaza y no se escribe nada (el comercio no podría cerrarlo)', async () => {
    for (const comercial of [SOLO_CL, CL_PE]) {
      const e = crearEntorno();
      const d = con(e, comercial);
      expect(await error(abrirTurno(d, T, caj, TURNO, { [comercial.monedas[0] ?? '']: 10000 }))).toMatchObject(NO_ADMITE);
      expect(e.db.dato(`tenants/${T}/turnos/${TURNO}`)).toBeUndefined();
      expect(e.db.dato(`tenants/${T}/pos_config/turno_activo`)).toBeUndefined();
      expect(e.db.coleccion(`tenants/${T}/auditoria`)).toHaveLength(0);
    }
  });

  it('registrar un movimiento de caja y solicitar una aprobación se rechazan sin escribir', async () => {
    const e = crearEntorno();
    await abrir(e);
    const antes = instantanea(e);
    const d = con(e, CL_PE);
    expect(await error(registrarMovimientoCaja(d, T, caj, UUID(70), { tipo: 'ingreso', moneda: 'CLP', monto: 1, motivo: 'm' }))).toMatchObject(NO_ADMITE);
    expect(await error(solicitarAprobacion(d, T, caj, UUID(71), { tipo: 'descuento', moneda: 'CLP', monto: 1, motivo: 'm' }))).toMatchObject(NO_ADMITE);
    expect(e.db.dato(`tenants/${T}/movimientos_caja/${UUID(70)}`)).toBeUndefined();
    expect(e.db.dato(`tenants/${T}/aprobaciones_descuento/${UUID(71)}`)).toBeUndefined();
    expect(instantanea(e)).toBe(antes);
  });

  it('no alcanza a vaciar estado existente: cobrar un crédito y anular una venta siguen permitidos', async () => {
    const e = crearEntorno();
    await abrir(e);
    const venta = await venderP1(e, 1);
    const d = con(e, CL_PE);
    // Los códigos de error de datos o permisos pueden aparecer, pero nunca el de la guardia.
    const c = await error(cobrarCredito(d, T, caj, UUID(80), UUID(81), { medio: 'efectivo', monto: 1 }));
    expect(c?.message).not.toBe(NO_ADMITE.message);
    const s = await error(solicitarAnulacion(d, T, caj, venta.venta.ventaId, 'motivo'));
    expect(s?.message).not.toBe(NO_ADMITE.message);
    const a = await error(aprobarAnulacion(d, T, sup, venta.venta.ventaId, 'motivo'));
    expect(a?.message).not.toBe(NO_ADMITE.message);
  });
});

describe('precio de la línea (función pura)', () => {
  const cl = SOLO_CL.mercados[0] as MercadoTenant;
  const pe = CL_PE.mercados[1] as MercadoTenant;
  const entrada = { nombre: 'X', cotizacion: null, redondeo: { CLP: cl.redondeo } as RedondeoPorMoneda };
  it('mercado sin tipo de cambio: el precio base redondeado con la regla del mercado', () => {
    expect(centavosDeLinea({ ...entrada, mercado: cl, moneda: 'CLP', base: 1234 })).toBe(123000);
    expect(centavosDeLinea({ ...entrada, mercado: cl, moneda: 'CLP', base: 1236 })).toBe(124000);
    expect(centavosDeLinea({ ...entrada, mercado: cl, moneda: 'CLP', base: 1234.4 })).toBe(123000);
  });
  it('sin precio en el mercado y a consultar', () => {
    expect(() => centavosDeLinea({ ...entrada, mercado: cl, moneda: 'CLP', base: undefined })).toThrow('El producto «X» no tiene precio en Chile; complételo en Inventarios');
    expect(() => centavosDeLinea({ ...entrada, mercado: cl, moneda: 'CLP', base: 0 })).toThrow(/a consultar/);
    expect(() => centavosDeLinea({ ...entrada, mercado: pe, moneda: 'USD', base: 0 })).toThrow(/a consultar/);
  });
  it('mercado sin tipo de cambio: manda la regla efectiva del comercio, no la del mercado', () => {
    const efectiva = { tipo: 'multiplo', multiplo: 100, modo: 'cercano' } as const;
    expect(centavosDeLinea({ ...entrada, mercado: cl, moneda: 'CLP', base: 1234, redondeo: { CLP: efectiva } })).toBe(120000);
    expect(centavosDeLinea({ ...entrada, mercado: cl, moneda: 'CLP', base: 1260, redondeo: { CLP: efectiva } })).toBe(130000);
    expect(centavosDeLinea({ ...entrada, mercado: cl, moneda: 'CLP', base: 1260 })).toBe(126000);
  });
  it('mercado sin tipo de cambio y sin regla efectiva: falla cerrado con un error claro', () => {
    expect(() => centavosDeLinea({ ...entrada, mercado: cl, moneda: 'CLP', base: 1234, redondeo: {} })).toThrow(/regla de redondeo para CLP/);
  });
  it('con tipo de cambio: en la base es el precio tal cual; en la venta usa la cotización y la regla de la moneda', () => {
    expect(centavosDeLinea({ ...entrada, mercado: pe, moneda: 'USD', base: 12.345 })).toBe(aCentavos(12.345));
    const cotizacion = { par: 'PEN/USD', valor: 3.71 };
    expect(centavosDeLinea({ ...entrada, mercado: pe, moneda: 'PEN', base: 10, cotizacion, redondeo: { PEN: REGLA2 } })).toBe(3710);
    expect(() => centavosDeLinea({ ...entrada, mercado: pe, moneda: 'PEN', base: 10, cotizacion: null, redondeo: { PEN: REGLA2 } })).toThrow(/cotización/);
    expect(() => centavosDeLinea({ ...entrada, mercado: pe, moneda: 'PEN', base: 10, cotizacion, redondeo: {} })).toThrow(/redondeo/);
  });
});

describe('equivalencia con el cálculo anterior del tenant de referencia', () => {
  const REGLAS = { BOB: REGLA2, ARS: { tipo: 'multiplo', multiplo: 100, modo: 'cercano' } } as const;
  const referencia = COMERCIAL_REFERENCIA.mercados.map((m) => (m.id === 'AR' ? { ...m, redondeo: REGLAS.ARS } : m));
  /** El cálculo anterior, copiado tal cual (con las uniones fijas BO/AR y USD). */
  function anterior(mercado: 'BO' | 'AR', moneda: 'BOB' | 'ARS' | 'USD', usd: number | undefined, cot: { par: string; valor: number } | null): string {
    try {
      if (usd === undefined) throw new ErrorPos('sin-precio', 'El producto no tiene precio en esta lista');
      if (moneda === 'USD') {
        if (!Number.isFinite(usd) || usd <= 0) throw new ErrorPos('sin-precio', 'El producto no tiene precio (a consultar)');
        return String(aCentavos(usd));
      }
      if (cot === null) throw new ErrorPos('dato-corrupto', 'Falta la cotización');
      const p = precioFinal(usd, mercado, cot, REGLAS);
      if (p.tipo === 'sin_precio') throw new ErrorPos('sin-precio', 'El producto no tiene precio (a consultar)');
      if (p.tipo === 'invalido') throw new ErrorPos('sin-precio', `No se pudo calcular el precio: ${p.motivo}`);
      return String(p.centavos);
    } catch (e) {
      return e instanceof ErrorPos ? `${e.codigo}:${e.message}` : 'otro';
    }
  }
  it('mismos centavos y mismos errores en una rejilla de precios, cotizaciones y monedas', () => {
    const precios = [0, 0.01, 0.5, 1, 4.995, 9.99, 12.345, 33.335, 100, 1234.56, 99999.99, -1, Number.NaN, undefined];
    const cotizaciones = { BO: [6.96, 7, 7.001, 9.1234], AR: [1000, 1234.5678, 1050.5, 0.5] } as const;
    let comparados = 0;
    for (const m of referencia) {
      const id = m.id as 'BO' | 'AR';
      const local = id === 'BO' ? 'BOB' : 'ARS';
      for (const usd of precios) {
        for (const moneda of [local, 'USD'] as const) {
          for (const valor of [...cotizaciones[id], null]) {
            const cot = valor === null ? null : { par: m.tipoCambio?.par ?? '', valor };
            const nuevo = ((): string => {
              try {
                return String(centavosDeLinea({ mercado: m, moneda, base: usd, nombre: 'X', cotizacion: cot, redondeo: REGLAS }));
              } catch (e) {
                return e instanceof ErrorPos ? `${e.codigo}:${e.message}` : 'otro';
              }
            })();
            const previo = anterior(id, moneda, usd, cot);
            // Único cambio deliberado: el mensaje de «sin precio en el mercado» nombra el producto y el mercado.
            if (usd === undefined) expect(nuevo).toBe(`sin-precio:El producto «X» no tiene precio en ${m.nombre}; complételo en Inventarios`);
            else expect(nuevo).toBe(previo);
            comparados += 1;
          }
        }
      }
    }
    expect(comparados).toBe(2 * precios.length * 2 * 5);
  });
});

describe('monedas declaradas en la apertura, los movimientos y las aprobaciones', () => {
  it('rechazan una moneda que el comercio no declara', async () => {
    const e = crearEntorno();
    const d = con(e, SOLO_BO);
    expect(await codigo(abrirTurno(d, T, caj, TURNO, { ARS: 1 }))).toBe('entrada-invalida');
    await abrirTurno(d, T, caj, TURNO, { BOB: 100 });
    expect(await codigo(registrarMovimientoCaja(d, T, caj, UUID(70), { tipo: 'ingreso', moneda: 'ARS', monto: 1, motivo: 'm' }))).toBe('entrada-invalida');
    expect(await codigo(solicitarAprobacion(d, T, caj, UUID(50), { tipo: 'descuento', moneda: 'ARS', monto: 1, motivo: 'm' }))).toBe('entrada-invalida');
    await registrarMovimientoCaja(d, T, caj, UUID(71), { tipo: 'ingreso', moneda: 'USD', monto: 1, motivo: 'm' });
  });
  it('la configuración exige que la moneda por defecto esté declarada y el valor inicial es la del primer mercado', async () => {
    const e = crearEntorno();
    expect(configPosPorDefecto(COMERCIAL_REFERENCIA).monedaPorDefecto).toBe('BOB');
    expect(configPosPorDefecto(SOLO_CL).monedaPorDefecto).toBe('CLP');
    expect(await e.db.runTransaction((tx) => leerConfigPos(tx, T, COMERCIAL_REFERENCIA))).toEqual(configPosPorDefecto(COMERCIAL_REFERENCIA));
    const valida = { ...configPosPorDefecto(COMERCIAL_REFERENCIA) };
    expect(() => validarConfigPos({ ...valida, monedaPorDefecto: 'ARS' }, ['BOB', 'USD'])).toThrow(ErrorPos);
    expect(await codigo(guardarConfigPos(con(e, SOLO_BO), T, adm, { ...valida, monedaPorDefecto: 'ARS' }))).toBe('entrada-invalida');
    await guardarConfigPos(con(e, SOLO_BO), T, adm, valida);
  });
});

describe('lectura tolerante de datos viejos', () => {
  it('una venta en una moneda que el comercio ya no declara se puede anular, y un turno viejo se puede cerrar', async () => {
    const e = crearEntorno();
    await abrir(e, caj, { BOB: 0, ARS: 0 });
    await confirmarVenta(e.deps, T, caj, UUID(1), carrito('AR', 'ARS'), pagoEfectivo('ARS', 1000000));
    const d = con(e, SOLO_BO); // el comercio dejó de declarar ARS
    await solicitarAnulacion(d, T, caj, UUID(1), 'devolución');
    const r = await aprobarAnulacion(d, T, sup, UUID(1), 'aprobada');
    expect(r.reembolsos).toEqual([{ medio: 'efectivo', moneda: 'ARS', monto: 1000000 }]);
    expect(e.db.dato(`tenants/${T}/ventas/${UUID(1)}`)).toMatchObject({ estado: 'anulada', moneda: 'ARS' });
    const { turno, arqueo } = await cerrarTurno(d, T, caj, TURNO, { BOB: 0, ARS: 0 });
    expect(turno.estado).toBe('cerrado');
    expect(Object.keys(arqueo)).toEqual(['BOB', 'ARS']);
  });
  it('ordena primero las declaradas (en su orden) y después el resto', () => {
    const turno = { apertura: { ZZZ: 1, ARS: 2, AAA: 3, BOB: 4 }, totales: {} };
    expect(Object.keys(proyectarTurno(turno, ['USD', 'BOB', 'ARS']))).toEqual(['BOB', 'ARS', 'AAA', 'ZZZ']);
    expect(Object.keys(calcularArqueo(turno, { ZZZ: 1, ARS: 2, AAA: 3, BOB: 4 }, ['ARS', 'BOB']))).toEqual(['ARS', 'BOB', 'AAA', 'ZZZ']);
    expect(Object.keys(proyectarTurno(turno))).toEqual(['BOB', 'ARS', 'AAA', 'ZZZ']);
  });
  it('el tenant de referencia conserva el orden BOB, USD, ARS y los eventos v1', async () => {
    const e = crearEntorno();
    await abrir(e, caj, { ARS: 0, BOB: 10000, USD: 0 });
    await venderP1(e, 1);
    const { arqueo } = await cerrarTurno(e.deps, T, caj, TURNO, { ARS: 0, USD: 0, BOB: 17000 });
    expect(Object.keys(arqueo)).toEqual(['BOB', 'USD', 'ARS']);
    for (const ev of eventos(e)) expect(ev['version']).toBe(1);
  });
});
