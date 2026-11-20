import { describe, expect, it } from 'vitest';
import { esNitValido, MENSAJE_NIT } from './nit.js';

describe('esNitValido', () => {
  it.each(['1234567', '1020304-1', '20-12345678-9', '12345', '1'.repeat(20)])('acepta %s', (n) => {
    expect(esNitValido(n)).toBe(true);
  });
  it.each(['12a45', '-12345', '12345-', '123--45', '1234', '1'.repeat(21), '', '123 456', 12345 as unknown as string])('rechaza %s', (n) => {
    expect(esNitValido(n)).toBe(false);
  });
  it('el mensaje describe la regla', () => {
    expect(MENSAJE_NIT).toContain('5 a 20');
  });
});
