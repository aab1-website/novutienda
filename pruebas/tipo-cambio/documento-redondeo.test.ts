import { describe, expect, it } from 'vitest';
import { COMERCIAL_LEGADO_TRES_MONEDAS, precioFinal, redondeoPorMoneda, type Mercado, type Redondeo, type ReglaRedondeo } from '@novutienda/nucleo';
import { interpretarRedondeo, interpretarRedondeoDe, REDONDEO_POR_DEFECTO, RedondeoInvalido } from '../../plataforma/funciones/servidor/redondeo.js';

// D7: el documento `config/redondeo` solo admite 0 a 2 decimales o un múltiplo de centavos exactos. Un documento con otra
// regla es inválido (falla cerrado con RedondeoInvalido, que el marco registra como alerta): jamás cae en los valores por omisión.
const BOB = { tipo: 'decimales', decimales: 2, modo: 'cercano' } as const;
const ARS = { tipo: 'multiplo', multiplo: 100, modo: 'cercano' } as const;
const NO_ADMITIDAS: unknown[] = [
  { tipo: 'ninguno' }, { tipo: 'decimales', decimales: 3, modo: 'cercano' }, { tipo: 'decimales', decimales: 6, modo: 'abajo' },
  { tipo: 'decimales', decimales: -1, modo: 'cercano' }, { tipo: 'decimales', decimales: 1.5, modo: 'cercano' },
  { tipo: 'multiplo', multiplo: 0.005, modo: 'cercano' }, { tipo: 'multiplo', multiplo: 0.015, modo: 'cercano' }, { tipo: 'multiplo', multiplo: 0, modo: 'cercano' },
  { tipo: 'multiplo', multiplo: 5, modo: 'raro' }, { tipo: 'raro' },
];

describe('documento config/redondeo (D7)', () => {
  it('los valores por omisión del servidor son reglas admitidas y no cambian', () => {
    expect(REDONDEO_POR_DEFECTO).toEqual({ BOB, ARS });
    expect(interpretarRedondeo(undefined)).toBe(REDONDEO_POR_DEFECTO);
  });
  it('acepta cada regla admitida', () => {
    for (const r of [{ tipo: 'decimales', decimales: 0, modo: 'arriba' }, { tipo: 'decimales', decimales: 1, modo: 'abajo' }, BOB,
      { tipo: 'multiplo', multiplo: 0.01, modo: 'cercano' }, { tipo: 'multiplo', multiplo: 0.05, modo: 'arriba' }, { tipo: 'multiplo', multiplo: 5, modo: 'abajo' }, ARS]) {
      expect(interpretarRedondeo({ BOB: r, ARS: r })).toEqual({ BOB: r, ARS: r });
    }
  });
  it('rechaza cada regla no admitida, en BOB y en ARS, sin caer en los valores por omisión', () => {
    for (const mala of NO_ADMITIDAS) {
      expect(() => interpretarRedondeo({ BOB: mala, ARS })).toThrow(RedondeoInvalido);
      expect(() => interpretarRedondeo({ BOB, ARS: mala })).toThrow(RedondeoInvalido);
      expect(() => interpretarRedondeoDe({ BOB: mala, ARS }, COMERCIAL_LEGADO_TRES_MONEDAS)).toThrow(RedondeoInvalido);
    }
  });
  it('un documento vacío, incompleto o con monedas de más sigue siendo inválido', () => {
    for (const d of [{}, { BOB }, { BOB, ARS, USD: BOB }]) expect(() => interpretarRedondeo(d)).toThrow(RedondeoInvalido);
  });
});

describe('tenant de tres monedas con los valores por omisión', () => {
  const R: Redondeo = REDONDEO_POR_DEFECTO;
  const casos: [number, Mercado, { par: string; valor: number }, unknown][] = [
    [10, 'BO', { par: 'BOB/USD', valor: 12.06 }, { tipo: 'precio', moneda: 'BOB', monto: 120.6, centavos: 12060 }],
    [19.99, 'BO', { par: 'BOB/USD', valor: 12.06 }, { tipo: 'precio', moneda: 'BOB', monto: 241.08, centavos: 24108 }],
    [12.345, 'BO', { par: 'BOB/USD', valor: 12.06 }, { tipo: 'precio', moneda: 'BOB', monto: 148.88, centavos: 14888 }],
    [10.5, 'AR', { par: 'ARS/USD', valor: 1520 }, { tipo: 'precio', moneda: 'ARS', monto: 16000, centavos: 1_600_000 }],
    [0.4, 'AR', { par: 'ARS/USD', valor: 1520 }, { tipo: 'precio', moneda: 'ARS', monto: 600, centavos: 60_000 }],
    [1, 'AR', { par: 'ARS/USD', valor: 1520 }, { tipo: 'precio', moneda: 'ARS', monto: 1500, centavos: 150_000 }],
    [0, 'BO', { par: 'BOB/USD', valor: 12.06 }, { tipo: 'sin_precio' }],
    [0.0001, 'BO', { par: 'BOB/USD', valor: 12.06 }, { tipo: 'invalido', motivo: 'el redondeo dejó el precio en cero' }],
  ];
  it('da exactamente los resultados de main (valores calculados con main)', () => {
    for (const [usd, m, cot, esperado] of casos) expect(precioFinal(usd, m, cot, R)).toEqual(esperado);
  });
  it('la política derivada de su configuración comercial es la misma que la de omisión', () => {
    expect(redondeoPorMoneda(COMERCIAL_LEGADO_TRES_MONEDAS)).toEqual(R);
  });
  it('un precio base menor a un centavo con una regla admitida no llega a «precio de 0 centavos»', () => {
    const r: ReglaRedondeo = BOB;
    expect(precioFinal(0.0001, 'BO', { par: 'BOB/USD', valor: 12.06 }, { BOB: r, ARS: r }).tipo).toBe('invalido');
  });
});
