import { describe, expect, it } from 'vitest';
import { telefonoValido } from './telefono.js';

describe('teléfono del cliente', () => {
  it('acepta los formatos habituales y el vacío', () => {
    for (const t of ['70012345', '+591 700-12345', '(2) 2123456', '']) expect(telefonoValido(t)).toBe(true);
  });
  it('rechaza pocos dígitos, demasiados y letras', () => {
    for (const t of ['12345', '1234567890123456', '7001234a']) expect(telefonoValido(t)).toBe(false);
  });
});
