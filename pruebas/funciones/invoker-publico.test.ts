import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Cada callable lo llama el navegador sin credencial de Google Cloud; si falta `invoker: 'public'`,
// un despliegue nuevo responde 401 antes de llegar al manejador (visto en `medios`).
const fuente = readFileSync(new URL('../../plataforma/funciones/servidor/index.ts', import.meta.url), 'utf8');

describe('callables con invocación pública', () => {
  const declaraciones = fuente.split('\n').filter((l) => /^export const \w+ = onCall\(/.test(l));

  it('hay cinco callables', () => {
    expect(declaraciones.map((l) => l.split(' ')[2])).toEqual(['pos', 'inventarios', 'consola', 'recibos', 'medios']);
  });

  it.each(declaraciones.map((l) => [l.split(' ')[2], l]))('%s declara invoker público', (_n, linea) => {
    expect(linea).toContain("invoker: 'public'");
  });
});
