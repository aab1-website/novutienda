import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { precioFinal, type Mercado, type ReglaRedondeo } from '@novutienda/nucleo';

// La tabla se calculó UNA vez con la implementación de `precioFinal` de main (antes del modelo de mercados por tenant):
// el legado no puede cambiar, ni con redondeo `ninguno`, ni con más de 2 decimales, ni con montos menores a un centavo.
const REGLAS: Record<string, ReglaRedondeo> = {
  ninguno: { tipo: 'ninguno' },
  dec2: { tipo: 'decimales', decimales: 2, modo: 'cercano' },
  dec3: { tipo: 'decimales', decimales: 3, modo: 'cercano' },
  dec6: { tipo: 'decimales', decimales: 6, modo: 'abajo' },
  dec0: { tipo: 'decimales', decimales: 0, modo: 'arriba' },
  mul100: { tipo: 'multiplo', multiplo: 100, modo: 'cercano' },
  mul005: { tipo: 'multiplo', multiplo: 0.005, modo: 'cercano' },
};
const num = (v: unknown): number => (typeof v === 'string' && v.startsWith('__') ? Number(v.slice(2)) : (v as number));

describe('precioFinal legado idéntico a main', () => {
  const tabla = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/precio-final-main.json', import.meta.url)), 'utf8')) as [unknown, Mercado, { par: string; valor: number }, string, unknown][];
  it('la tabla es amplia', () => expect(tabla.length).toBeGreaterThan(500));
  it('devuelve lo mismo que main en todos los casos', () => {
    for (const [base, mercado, cot, regla, esperado] of tabla) {
      const r = REGLAS[regla]!;
      expect(precioFinal(num(base), mercado, cot, { BOB: r, ARS: r }), JSON.stringify([base, mercado, cot, regla])).toEqual(esperado);
    }
  });
  it('conserva los casos que la API estricta rechaza', () => {
    const r = { BOB: REGLAS['ninguno']!, ARS: REGLAS['ninguno']! };
    expect(precioFinal(0.0001, 'BO', { par: 'BOB/USD', valor: 12.06 }, r)).toEqual({ tipo: 'precio', moneda: 'BOB', monto: 0.001206, centavos: 0 });
  });
});
