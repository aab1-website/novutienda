import { describe, expect, it } from 'vitest';
import { esProduccion, textoRobots } from './indexacion.js';

describe('indexación por ambiente', () => {
  it('solo producción es indexable', () => {
    expect(esProduccion('production')).toBe(true);
    for (const a of ['staging', 'development', '', undefined]) expect(esProduccion(a)).toBe(false);
  });
  it('robots.txt: fuera de producción prohíbe todo; en producción permite y protege /api/', () => {
    expect(textoRobots('staging')).toContain('Disallow: /\n');
    expect(textoRobots(undefined)).not.toContain('Allow');
    expect(textoRobots('production')).toContain('Allow: /');
    expect(textoRobots('production')).toContain('Disallow: /api/');
  });
});
