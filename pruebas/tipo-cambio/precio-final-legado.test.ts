import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { precioFinal, type Mercado, type ReglaRedondeo } from '@novutienda/nucleo';

// La tabla se calculó UNA vez con la implementación de `precioFinal` de main (antes de D7) y se conserva solo con las reglas
// que D7 sigue admitiendo (dec2, dec0, mul100: 216 casos): con ellas el resultado NO cambia. SALIERON 288 casos de los 504
// originales, los de las reglas que D7 (13/11/2026) dejó de admitir: `ninguno`, `decimales: 3`, `decimales: 6` y el múltiplo
// 0,005 (no es de centavos exactos), 72 casos por regla. Esos pasan a esperar el rechazo (prueba de abajo).
const REGLAS: Record<string, ReglaRedondeo> = {
  dec2: { tipo: 'decimales', decimales: 2, modo: 'cercano' },
  dec0: { tipo: 'decimales', decimales: 0, modo: 'arriba' },
  mul100: { tipo: 'multiplo', multiplo: 100, modo: 'cercano' },
};
const NO_ADMITIDAS: Record<string, unknown> = {
  ninguno: { tipo: 'ninguno' },
  dec3: { tipo: 'decimales', decimales: 3, modo: 'cercano' },
  dec6: { tipo: 'decimales', decimales: 6, modo: 'abajo' },
  mul005: { tipo: 'multiplo', multiplo: 0.005, modo: 'cercano' },
};
const num = (v: unknown): number => (typeof v === 'string' && v.startsWith('__') ? Number(v.slice(2)) : (v as number));

describe('precioFinal idéntico a main para las reglas admitidas', () => {
  const tabla = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/precio-final-main.json', import.meta.url)), 'utf8')) as [unknown, Mercado, { par: string; valor: number }, string, unknown][];
  it('la tabla es amplia', () => expect(tabla.length).toBe(216));
  it('devuelve lo mismo que main en todos los casos', () => {
    for (const [base, mercado, cot, regla, esperado] of tabla) {
      const r = REGLAS[regla]!;
      expect(precioFinal(num(base), mercado, cot, { BOB: r, ARS: r }), JSON.stringify([base, mercado, cot, regla])).toEqual(esperado);
    }
  });
  it('las reglas que D7 dejó de admitir hacen fallar cerrado, no calculan un precio', () => {
    for (const mala of Object.values(NO_ADMITIDAS)) {
      for (const [mercado, cot] of [['BO', { par: 'BOB/USD', valor: 12.06 }], ['AR', { par: 'ARS/USD', valor: 1520 }]] as const) {
        for (const base of [0.0001, 0.4, 10, 19.99]) {
          const r = precioFinal(base, mercado, cot, { BOB: mala as ReglaRedondeo, ARS: mala as ReglaRedondeo });
          expect(r.tipo, JSON.stringify([mala, mercado, base])).toBe('invalido');
        }
      }
    }
  });
});
