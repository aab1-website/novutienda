import { describe, expect, it } from 'vitest';
import { esReglaRedondeoValida } from '@novutienda/nucleo';

// El múltiplo es de al menos 0,01 y exacto en centavos: sin tolerancia que admita residuos de punto flotante.
describe('regla de redondeo por múltiplo: centavos exactos', () => {
  it.each([0.0100000000005, 0.015, 0.005, 0])('rechaza el múltiplo %s', (multiplo) => {
    expect(esReglaRedondeoValida({ tipo: 'multiplo', multiplo, modo: 'cercano' })).toBe(false);
  });
  it.each([0.01, 0.05, 0.5, 50, 100])('acepta el múltiplo %s', (multiplo) => {
    expect(esReglaRedondeoValida({ tipo: 'multiplo', multiplo, modo: 'cercano' })).toBe(true);
  });
});
