// WCAG 2.5.3 (Label in Name, regla axe `label-content-name-mismatch`): si un <Boton> lleva `etiqueta` (aria-label) y su
// texto visible es literal, el nombre accesible debe EMPEZAR por ese texto («Editar» -> «Editar producto X»).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const carpetas = ['paquetes/panel/src/pantallas/consola', 'paquetes/panel/src/ui'];
const raiz = join(__dirname, '..', '..');

function fuentes(dir: string): string[] {
  return readdirSync(join(raiz, dir)).filter((f) => f.endsWith('.tsx') && !f.includes('.test.')).map((f) => join(raiz, dir, f));
}

/** Pares (etiqueta, texto visible) de los <Boton ... etiqueta=...>Texto</Boton> escritos en un solo bloque. */
function pares(src: string): { etiqueta: string; visible: string }[] {
  const re = /<Boton\b(?:=>|[^>])*?\betiqueta=(?:"([^"]*)"|\{`([^`]*)`\})(?:=>|[^>])*>\s*([^<{}]+?)\s*<\/Boton>/g;
  return [...src.matchAll(re)].map((m) => ({ etiqueta: (m[1] ?? m[2]) as string, visible: m[3] as string }));
}

describe('botones con etiqueta: el nombre accesible empieza por el texto visible', () => {
  for (const f of carpetas.flatMap(fuentes)) {
    it(f.slice(raiz.length + 1), () => {
      for (const { etiqueta, visible } of pares(readFileSync(f, 'utf8'))) {
        expect(etiqueta.toLowerCase().startsWith(visible.toLowerCase()), `«${etiqueta}» no empieza por «${visible}»`).toBe(true);
      }
    });
  }
  it('el detector encuentra los botones del catálogo', () => {
    const n = fuentes(carpetas[0] as string).flatMap((f) => pares(readFileSync(f, 'utf8'))).length;
    expect(n).toBeGreaterThanOrEqual(6);
  });
});
