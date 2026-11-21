import { describe, expect, it } from 'vitest';
import { desgloseEfectivo, efectivoEsperado } from './arqueo.js';

describe('desgloseEfectivo (panel): la suma de las líneas es el efectivo esperado', () => {
  for (const [apertura, efectivo, ingresos, egresos, dev] of [[0, 0, 0, 0, 0], [50000, 80000, 3000, 7000, 15000], [10000, -5000, 0, 2000, 5000], [0, 0, 0, 9000, 0]] as const) {
    it(`${apertura}/${efectivo}/${ingresos}/${egresos}/${dev}`, () => {
      const t = { efectivo, qr: 9, transferencia: 9, credito: 9, ingresos, egresos };
      const d = desgloseEfectivo(apertura, t, dev);
      expect(d.apertura + d.cobrado - d.devuelto + d.ingresos - d.egresos).toBe(efectivoEsperado(apertura, t));
    });
  }
});
