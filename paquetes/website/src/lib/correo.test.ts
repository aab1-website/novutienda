import { describe, expect, it } from 'vitest';
import { hrefCorreo } from './correo.js';

describe('hrefCorreo', () => {
  it('arma el mailto solo con un correo simple', () => {
    expect(hrefCorreo('ventas@sutienda.com')).toBe('mailto:ventas@sutienda.com');
    expect(hrefCorreo('a.b+c@sub.ejemplo.test')).toBe('mailto:a.b+c@sub.ejemplo.test');
  });
  it('sin forma de correo o con parámetros engañosos: sin enlace (se muestra como texto)', () => {
    for (const c of ['sin-arroba-aqui', 'a@@b.co', 'a b@c.co', 'a@b', '@b.co', 'a@b.', 'a@b.co>', 'a@"b.co', 'a@b.co ?bcc=x@evil.test', '', `${'x'.repeat(250)}@b.co`]) {
      expect(hrefCorreo(c), c).toBeNull();
    }
  });
});
