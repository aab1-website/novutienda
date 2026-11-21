import { describe, expect, it } from 'vitest';
import { desgloseEfectivo, efectivoEsperado, reconstruirTotales } from '@novutienda/pos';

const sumar = (d: ReturnType<typeof desgloseEfectivo>): number => d.apertura + d.cobrado - d.devuelto + d.ingresos - d.egresos;

describe('desgloseEfectivo: la suma de las líneas es el efectivo esperado', () => {
  const casos = [
    { apertura: 0, efectivo: 0, ingresos: 0, egresos: 0, dev: 0 },
    { apertura: 50000, efectivo: 120000, ingresos: 3000, egresos: 7000, dev: 0 },
    { apertura: 50000, efectivo: 80000, ingresos: 0, egresos: 0, dev: 15000 },
    { apertura: 10000, efectivo: -5000, ingresos: 0, egresos: 2000, dev: 5000 },
    { apertura: 0, efectivo: 0, ingresos: 0, egresos: 9000, dev: 0 },
  ];
  for (const c of casos) {
    it(JSON.stringify(c), () => {
      const t = { efectivo: c.efectivo, qr: 1, transferencia: 2, credito: 3, ingresos: c.ingresos, egresos: c.egresos };
      const d = desgloseEfectivo(c.apertura, t, c.dev);
      expect(sumar(d)).toBe(efectivoEsperado(c.apertura, t));
      expect(d.esperado).toBe(efectivoEsperado(c.apertura, t));
    });
  }
  it('con totales reconstruidos de operaciones reales', () => {
    const t = reconstruirTotales('t1', {
      ventas: [{ turnoId: 't1', moneda: 'BOB', pagos: [{ medio: 'efectivo', monto: 10000, cambio: 500 }] }],
      cobrosCredito: [],
      movimientos: [{ turnoId: 't1', moneda: 'BOB', tipo: 'egreso', monto: 1000 }],
      anulaciones: [{ turnoIdReembolso: 't1', moneda: 'BOB', reembolsos: [{ medio: 'efectivo', monto: 3000 }], creditoCancelado: 0 }],
    }).BOB!;
    expect(sumar(desgloseEfectivo(2000, t, 3000))).toBe(efectivoEsperado(2000, t));
  });
});
