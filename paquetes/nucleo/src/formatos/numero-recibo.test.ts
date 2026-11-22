import { describe, expect, it } from 'vitest';
import { aliasRecibo, interpretarNumeroRecibo, numeroDeRecibo } from './numero-recibo.js';

describe('número de recibo', () => {
  it('formatea con relleno de 6', () => expect(numeroDeRecibo('A', 6)).toBe('A-000006'));
  it('da los alias de búsqueda', () => expect(aliasRecibo('A', 6)).toEqual(['A-000006', 'A6', 'A-6', '6']));
  it.each([
    ['A6', { serie: 'A', numero: 6 }],
    ['a-6', { serie: 'A', numero: 6 }],
    ['A-000006', { serie: 'A', numero: 6 }],
    [' 6 ', { numero: 6 }],
    ['000006', { numero: 6 }],
  ])('interpreta %s', (t, esperado) => expect(interpretarNumeroRecibo(t)).toEqual(esperado));
  it.each(['', 'A', 'A-', '0', 'A-x', '6A', '1.5', '-6'])('rechaza «%s»', (t) => expect(interpretarNumeroRecibo(t)).toBeNull());
  it('una entrada larga de espacios responde rápido y da null', () => {
    const ini = Date.now();
    expect(interpretarNumeroRecibo('A' + ' '.repeat(50000) + 'x')).toBeNull();
    expect(interpretarNumeroRecibo(' '.repeat(50000) + '6')).toBeNull();
    expect(Date.now() - ini).toBeLessThan(200);
  });
  it('rechaza series de más de 5 letras', () => expect(interpretarNumeroRecibo('ABCDEF6')).toBeNull());
});
