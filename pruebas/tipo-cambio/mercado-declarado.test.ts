import { describe, expect, it } from 'vitest';
import {
  COMERCIAL_LEGADO_TRES_MONEDAS,
  MERCADOS,
  MONEDA_DE,
  PAR_DE,
  ZONA_DE,
  hoyEn,
  manejarCotizacion,
  mercadoDe,
  mercadosDe,
  monedaDe,
  parDe,
  precioDeMercado,
  precioFinal,
  redondeoPorMoneda,
  zonaDe,
  type ConfiguracionComercial,
  type CopiaCotizacion,
} from '@novutienda/nucleo';

const bo = mercadoDe(COMERCIAL_LEGADO_TRES_MONEDAS, 'BO')!;
const ar = mercadoDe(COMERCIAL_LEGADO_TRES_MONEDAS, 'AR')!;
const co = {
  id: 'CO', nombre: 'Colombia', monedaVenta: 'COP', monedaBase: 'COP', zonaHoraria: 'America/Bogota',
  tipoCambio: null, redondeo: { tipo: 'multiplo', multiplo: 50, modo: 'cercano' },
} as const;
const unaMoneda: ConfiguracionComercial = { mercados: [co], monedas: ['COP'] };

describe('constantes LEGADO = derivadas de la declaración explícita', () => {
  it('tienen exactamente la forma y los valores de siempre', () => {
    expect(MERCADOS).toEqual(['BO', 'AR']);
    expect(PAR_DE).toEqual({ BO: 'BOB/USD', AR: 'ARS/USD' });
    expect(MONEDA_DE).toEqual({ BO: 'BOB', AR: 'ARS' });
    expect(ZONA_DE).toEqual({ BO: 'America/La_Paz', AR: 'America/Argentina/Buenos_Aires' });
    expect(Object.keys(PAR_DE)).toEqual(['BO', 'AR']);
  });
  it('coinciden con las funciones puras sobre la declaración', () => {
    const c = COMERCIAL_LEGADO_TRES_MONEDAS;
    expect([...MERCADOS]).toEqual([...mercadosDe(c)]);
    for (const m of MERCADOS) {
      expect(PAR_DE[m]).toBe(parDe(c, m));
      expect(MONEDA_DE[m]).toBe(monedaDe(c, m));
      expect(ZONA_DE[m]).toBe(zonaDe(c, m));
    }
  });
});

describe('precioDeMercado', () => {
  it('con tipo de cambio da lo mismo que precioFinal (misma forma, sin `sinCotizacion`)', () => {
    const red = redondeoPorMoneda(COMERCIAL_LEGADO_TRES_MONEDAS);
    for (const [m, mer, cot] of [['BO', bo, { par: 'BOB/USD', valor: 12.06 }], ['AR', ar, { par: 'ARS/USD', valor: 1520 }]] as const) {
      for (const usd of [0, 10, 19.99, 10.5, 0.0001]) {
        expect(precioDeMercado(usd, mer, cot)).toEqual(precioFinal(usd, m, cot, red));
      }
    }
    expect(precioDeMercado(10, bo, { par: 'BOB/USD', valor: 12.06 })).toEqual({ tipo: 'precio', moneda: 'BOB', monto: 120.6, centavos: 12060 });
  });
  it('sin tipo de cambio devuelve el precio base redondeado y marcado sin cotización', () => {
    expect(precioDeMercado(12345.6, co, null)).toEqual({ tipo: 'precio', moneda: 'COP', monto: 12350, centavos: 1_235_000, sinCotizacion: true });
    // una cotización recibida se ignora: el mercado no la usa
    expect(precioDeMercado(12345.6, co, { par: 'COP/USD', valor: 4000 })).toMatchObject({ monto: 12350, sinCotizacion: true });
  });
  it('0 es «sin precio»; negativo, NaN y redondeo a cero son inválidos', () => {
    expect(precioDeMercado(0, co, null)).toEqual({ tipo: 'sin_precio' });
    expect(precioDeMercado(-1, co, null)).toMatchObject({ tipo: 'invalido', motivo: expect.stringContaining('COP') });
    expect(precioDeMercado(Number.NaN, co, null)).toMatchObject({ tipo: 'invalido' });
    expect(precioDeMercado(10, co, null)).toMatchObject({ tipo: 'invalido', motivo: expect.stringContaining('cero') });
  });
  it('con tipo de cambio exige cotización y del par del mercado', () => {
    expect(precioDeMercado(10, bo, null)).toMatchObject({ tipo: 'invalido', motivo: expect.stringContaining('cotización') });
    expect(precioDeMercado(10, bo, { par: 'ARS/USD', valor: 1500 })).toMatchObject({ tipo: 'invalido', motivo: expect.stringContaining('no corresponde') });
    expect(precioDeMercado(10, bo, { par: 'BOB/USD', valor: 0 })).toMatchObject({ tipo: 'invalido' });
  });
  it('redondeo parcial por moneda: solo hace falta la regla de la moneda de venta', () => {
    expect(precioFinal(10, 'BO', { par: 'BOB/USD', valor: 12.06 }, { BOB: bo.redondeo })).toMatchObject({ tipo: 'precio', monto: 120.6 });
    expect(precioFinal(10, 'AR', { par: 'ARS/USD', valor: 1520 }, { BOB: bo.redondeo })).toMatchObject({ tipo: 'invalido', motivo: expect.stringContaining('ARS') });
  });
  it('acepta otra moneda base con par venta/base', () => {
    const cl = { ...co, id: 'CL', monedaVenta: 'CLP', monedaBase: 'USD', tipoCambio: { par: 'CLP/USD', fuentes: ['manual'] }, redondeo: { tipo: 'decimales', decimales: 0, modo: 'cercano' } } as const;
    expect(precioDeMercado(2, cl, { par: 'CLP/USD', valor: 950.4 })).toEqual({ tipo: 'precio', moneda: 'CLP', monto: 1901, centavos: 190_100 });
  });
});

describe('zona horaria y /api/cotizacion por tenant', () => {
  it('hoyEn usa la zona declarada y falla cerrado en un mercado no declarado', () => {
    const t = Date.UTC(2026, 10, 14, 3, 0); // 14/11 03:00 UTC = 13/11 22:00 en Bogotá
    expect(hoyEn('CO', t, unaMoneda)).toBe('2026-11-13');
    expect(hoyEn('BO', t)).toBe('2026-11-13');
    expect(() => hoyEn('CO', t)).toThrow(RangeError);
  });
  it('un mercado sin tipo de cambio no aparece en la cotización general ni se pide', async () => {
    const leer = async (): Promise<CopiaCotizacion<string>> => { throw new Error('no se debe leer'); };
    expect(await manejarCotizacion({ metodo: 'GET' }, leer, unaMoneda)).toMatchObject({ status: 200, cuerpo: { cotizaciones: {} } });
    expect(await manejarCotizacion({ metodo: 'GET', mercado: 'CO' }, leer, unaMoneda)).toMatchObject({ status: 200, cuerpo: { cotizaciones: {}, sinTipoCambio: ['CO'] } });
    expect(await manejarCotizacion({ metodo: 'GET', mercado: 'BO' }, leer, unaMoneda)).toMatchObject({ status: 400 });
  });
});
