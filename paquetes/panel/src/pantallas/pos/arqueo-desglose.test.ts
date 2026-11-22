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

describe('desgloseEfectivo: totales como los deja la reconstrucción del servidor', () => {
  // Venta en efectivo de 100,00 con cambio de 5,00, egreso de 10,00 y anulación con reembolso en efectivo de 30,00:
  // `efectivo` queda neto (10000 - 500 - 3000), como en `reconstruirTotales` del módulo (el panel no lo puede importar).
  it('cobrado = neto + devuelto, y la suma cuadra', () => {
    const t = { efectivo: 6500, qr: 0, transferencia: 0, credito: 0, ingresos: 0, egresos: 1000 };
    const d = desgloseEfectivo(2000, t, 3000);
    expect(d).toMatchObject({ apertura: 2000, cobrado: 9500, devuelto: 3000, egresos: 1000, esperado: 7500 });
    expect(d.apertura + d.cobrado - d.devuelto + d.ingresos - d.egresos).toBe(efectivoEsperado(2000, t));
  });
  it('un devuelto negativo se ignora', () => {
    const t = { efectivo: 100, qr: 0, transferencia: 0, credito: 0, ingresos: 0, egresos: 0 };
    expect(desgloseEfectivo(0, t, -5)).toMatchObject({ cobrado: 100, devuelto: 0 });
  });
});
