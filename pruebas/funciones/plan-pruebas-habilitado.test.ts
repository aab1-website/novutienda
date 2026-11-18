import { describe, expect, it } from 'vitest';
import { planPruebasHabilitado } from '../../plataforma/funciones/servidor/entorno.js';

describe('planPruebasHabilitado', () => {
  it('solo el valor exacto «si» habilita', () => {
    expect(planPruebasHabilitado('si')).toBe(true);
  });
  it.each(['', 'SI', 'true', '1', 'si '])('«%s» no habilita', (v) => {
    expect(planPruebasHabilitado(v)).toBe(false);
  });
});
