// `vistaComercial` sin emulador: la moneda de costo solo se entrega si se pide (el borde la pide para el rol `adm`).
import { describe, expect, it } from 'vitest';
import { vistaComercial } from '../../plataforma/coordinador/comercial.js';
import { COMERCIAL_TRES } from '../inventarios/entorno.js';

describe('vistaComercial', () => {
  it('por defecto no incluye monedaCosto (el campo está ausente, no undefined)', () => {
    const v = vistaComercial(COMERCIAL_TRES);
    expect('monedaCosto' in v).toBe(false);
  });
  it('con incluirCosto entrega solo el código de la moneda de costo', () => {
    expect(vistaComercial({ ...COMERCIAL_TRES, monedaCosto: 'EUR' }, true).monedaCosto).toBe('EUR');
    expect(vistaComercial(COMERCIAL_TRES, true).monedaCosto).toBe('USD');
    expect('monedaCosto' in vistaComercial(COMERCIAL_TRES, false)).toBe(false);
  });
});
