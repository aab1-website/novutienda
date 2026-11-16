import { describe, expect, it } from 'vitest';
import { validarTenant, COMERCIAL_LEGADO_TRES_MONEDAS, PLANES, esPlanId, validarComercialContraPlan, type ConfiguracionComercial } from '@novutienda/nucleo';

const una: ConfiguracionComercial = {
  mercados: [{ id: 'CO', nombre: 'Colombia', monedaVenta: 'COP', monedaBase: 'COP', zonaHoraria: 'America/Bogota', tipoCambio: null, redondeo: { tipo: 'decimales', decimales: 2, modo: 'cercano' } }],
  monedas: ['COP'],
};

describe('topes comerciales por plan', () => {
  it('el plan base admite 1 mercado y 1 moneda; el multimercado, varios', () => {
    expect(PLANES.base).toMatchObject({ mercados: 1, monedas: 1 });
    expect(PLANES.multimercado.mercados).toBeGreaterThanOrEqual(2);
    expect(PLANES.multimercado.monedas).toBeGreaterThanOrEqual(3);
    expect(esPlanId('multimercado')).toBe(true);
  });
  it('el plan base acepta un tenant de una moneda', () => {
    expect(validarComercialContraPlan('base', una)).toEqual({ ok: true, valor: una });
  });
  it('el plan base rechaza dos mercados y dice el tope', () => {
    expect(validarComercialContraPlan('base', COMERCIAL_LEGADO_TRES_MONEDAS)).toMatchObject({ ok: false, error: expect.stringContaining('1 mercado') });
  });
  it('el plan base rechaza dos monedas de caja con un solo mercado', () => {
    expect(validarComercialContraPlan('base', { ...una, monedas: ['COP', 'USD'] })).toMatchObject({ ok: false, error: expect.stringContaining('1 moneda') });
  });
  it('el plan multimercado admite el tenant de tres monedas', () => {
    expect(validarComercialContraPlan('multimercado', COMERCIAL_LEGADO_TRES_MONEDAS).ok).toBe(true);
  });
});

describe('forma legado frente a los topes', () => {
  it('el documento legado en plan base sigue válido: no pasa por validarComercialContraPlan hasta el PR E', () => {
    const legado = { estado: 'activo', plan: 'base', modulos: {}, zonaHoraria: 'America/La_Paz', monedas: ['BOB', 'USD', 'ARS'] };
    expect(validarTenant(legado).ok).toBe(true);
    // la misma configuración, declarada como v3, sí se mide contra el plan
    expect(validarTenant({ estado: 'activo', plan: 'base', modulos: {}, comercial: COMERCIAL_LEGADO_TRES_MONEDAS }).ok).toBe(false);
    expect(validarTenant({ estado: 'activo', plan: 'multimercado', modulos: {}, comercial: COMERCIAL_LEGADO_TRES_MONEDAS }).ok).toBe(true);
  });
});
