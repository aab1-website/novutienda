// `descripcion` del catálogo de NovuChat: una línea, 300 caracteres o menos, sin partir palabras ni emojis.
import { describe, expect, it } from 'vitest';
import { descripcionCorta, MAX_DESCRIPCION_CATALOGO } from '../../plataforma/funciones/servidor/http/novuchat.js';

describe('descripcionCorta', () => {
  it('colapsa espacios y saltos de línea', () => {
    expect(descripcionCorta('  Hola\n\n  mundo\tbonito  ')).toBe('Hola mundo bonito');
  });

  it('un texto de 300 justos queda intacto', () => {
    const t = 'a'.repeat(MAX_DESCRIPCION_CATALOGO);
    expect(descripcionCorta(t)).toBe(t);
  });

  it('corta en el último espacio y termina en «…»', () => {
    const d = descripcionCorta('palabra '.repeat(60));
    expect(d.length).toBeLessThanOrEqual(MAX_DESCRIPCION_CATALOGO);
    expect(d).toMatch(/ palabra…$/);
  });

  it('conserva la palabra que cabe justo con el «…» (300 en total)', () => {
    const t = `${'x'.repeat(200)} ${'y'.repeat(98)} zzz`; // la palabra de «y» termina en el carácter 299
    expect(descripcionCorta(t)).toBe(`${'x'.repeat(200)} ${'y'.repeat(98)}…`);
  });

  it('una palabra larga sin espacios se corta a 299 más «…»', () => {
    const d = descripcionCorta('b'.repeat(500));
    expect(d).toBe(`${'b'.repeat(299)}…`);
  });

  it('no deja medio emoji', () => {
    const d = descripcionCorta('😀'.repeat(200));
    expect(d.length).toBeLessThanOrEqual(MAX_DESCRIPCION_CATALOGO);
    expect(d).not.toMatch(/[\uD800-\uDBFF]…$/);
    expect(d.endsWith('😀…')).toBe(true);
  });
});
