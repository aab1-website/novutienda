import { describe, expect, it } from 'vitest';
import { normalizar } from './buscar.js';

describe('normalizar', () => {
  it('quita tildes, mayúsculas y espacios de los bordes', () => {
    expect(normalizar('  ÁRBOL Ñandú Pingüino ')).toBe('arbol nandu pinguino');
  });
  it('es idempotente y acepta vacío', () => {
    expect(normalizar(normalizar('Café'))).toBe('cafe');
    expect(normalizar('')).toBe('');
  });
});
