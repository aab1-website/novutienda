import { describe, expect, it } from 'vitest';
import { aCentavos, precioFinal, redondear, type Redondeo } from './nucleo-tc.js';

const bo = { par: 'BOB/USD', valor: 12.06 };
const ar = { par: 'ARS/USD', valor: 1520 };
const R: Redondeo = { BOB: { tipo: 'decimales', decimales: 2, modo: 'cercano' }, ARS: { tipo: 'multiplo', multiplo: 100, modo: 'arriba' } };

describe('precioFinal', () => {
  it('multiplica USD por la cotización del mercado y redondea según la regla de la moneda', () => {
    expect(precioFinal(10, 'BO', bo, R)).toEqual({ tipo: 'precio', moneda: 'BOB', monto: 120.6, centavos: 12060 });
    expect(precioFinal(19.99, 'BO', bo, R)).toEqual({ tipo: 'precio', moneda: 'BOB', monto: 241.08, centavos: 24108 });
    expect(precioFinal(10.5, 'AR', ar, R)).toEqual({ tipo: 'precio', moneda: 'ARS', monto: 16000, centavos: 1_600_000 });
  });
  it('precio 0 es «sin precio», no un precio de cero', () => {
    expect(precioFinal(0, 'BO', bo, R)).toEqual({ tipo: 'sin_precio' });
  });
  it('rechaza entradas inválidas en vez de inventar un precio', () => {
    expect(precioFinal(-1, 'BO', bo, R)).toMatchObject({ tipo: 'invalido' });
    expect(precioFinal(Number.NaN, 'BO', bo, R)).toMatchObject({ tipo: 'invalido' });
    expect(precioFinal(10, 'BO', ar, R)).toMatchObject({ tipo: 'invalido', motivo: expect.stringContaining('no corresponde') });
    expect(precioFinal(10, 'BO', { par: 'BOB/USD', valor: 0 }, R)).toMatchObject({ tipo: 'invalido' });
    expect(precioFinal(10, 'BO', bo, {} as Redondeo)).toMatchObject({ tipo: 'invalido', motivo: expect.stringContaining('redondeo') });
    expect(precioFinal(10, 'BO', bo, { ...R, BOB: { tipo: 'decimales', decimales: -1, modo: 'cercano' } })).toMatchObject({ tipo: 'invalido' });
    expect(precioFinal(10, 'BO', bo, { ...R, BOB: { tipo: 'multiplo', multiplo: 0, modo: 'cercano' } })).toMatchObject({ tipo: 'invalido' });
    expect(precioFinal(0.0001, 'BO', bo, { ...R, BOB: { tipo: 'decimales', decimales: 2, modo: 'abajo' } })).toMatchObject({ tipo: 'invalido', motivo: expect.stringContaining('cero') });
  });
  it('«ninguno» deja el monto sin redondear', () => {
    expect(precioFinal(10, 'BO', bo, { ...R, BOB: { tipo: 'ninguno' } })).toEqual({ tipo: 'precio', moneda: 'BOB', monto: 120.6, centavos: 12060 });
  });
});

describe('redondear', () => {
  it('sin ruido de coma flotante', () => {
    expect(redondear(1.005, { tipo: 'decimales', decimales: 2, modo: 'cercano' })).toBe(1.01);
    expect(redondear(2.675, { tipo: 'decimales', decimales: 2, modo: 'cercano' })).toBe(2.68);
  });
  it('arriba, abajo y cercano, por decimales y por múltiplo', () => {
    expect(redondear(10.231, { tipo: 'decimales', decimales: 2, modo: 'arriba' })).toBe(10.24);
    expect(redondear(10.239, { tipo: 'decimales', decimales: 2, modo: 'abajo' })).toBe(10.23);
    expect(redondear(10.4, { tipo: 'decimales', decimales: 0, modo: 'cercano' })).toBe(10);
    expect(redondear(1234, { tipo: 'multiplo', multiplo: 50, modo: 'abajo' })).toBe(1200);
    expect(redondear(1234, { tipo: 'multiplo', multiplo: 50, modo: 'arriba' })).toBe(1250);
    expect(redondear(1226, { tipo: 'multiplo', multiplo: 50, modo: 'cercano' })).toBe(1250);
    expect(redondear(7.123, { tipo: 'ninguno' })).toBe(7.123);
  });
});

describe('aCentavos', () => {
  it('convierte a enteros sin ruido de coma flotante', () => {
    expect(aCentavos(120.6)).toBe(12060);
    expect(aCentavos(1.005)).toBe(101);
    expect(aCentavos(0.29)).toBe(29);
    expect(aCentavos(19.99 * 3)).toBe(5997);
    expect(Number.isInteger(aCentavos(241.08))).toBe(true);
  });
  it('lanza si no es un entero seguro, y precioFinal lo marca inválido', () => {
    expect(() => aCentavos(1e300)).toThrow(RangeError);
    expect(() => aCentavos(Number.NaN)).toThrow(RangeError);
    expect(precioFinal(1e300, 'BO', bo, { ...R, BOB: { tipo: 'ninguno' } })).toMatchObject({ tipo: 'invalido' });
  });
  it('con redondeo «ninguno» el precio trae centavos enteros', () => {
    const r = precioFinal(10.123, 'BO', bo, { ...R, BOB: { tipo: 'ninguno' } });
    expect(r).toMatchObject({ tipo: 'precio', centavos: 12208 });
  });
});
