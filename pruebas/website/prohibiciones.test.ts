// Prohibiciones del sitio, verificadas sobre el código fuente del paquete.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const PAQUETE = join(RAIZ, 'paquetes/website');

function archivos(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (n === 'node_modules' || n === '.astro' || n === 'dist') return [];
    const r = join(dir, n);
    return statSync(r).isDirectory() ? archivos(r, ext) : ext.test(n) ? [r] : [];
  });
}
const fuentes = (ext: RegExp, incluirPruebas = false): [string, string][] =>
  archivos(join(PAQUETE, 'src'), ext)
    .filter((f) => incluirPruebas || !f.endsWith('.test.ts'))
    .map((f) => [relative(PAQUETE, f), readFileSync(f, 'utf8')]);

const CODIGO = /\.(ts|tsx|astro)$/;

describe('código del sitio', () => {
  it('no renderiza HTML crudo ni evalúa texto (salvo el JSON-LD y el bloque de configuración, escapados)', () => {
    for (const [f, c] of fuentes(CODIGO)) {
      expect(c, f).not.toMatch(/\b(innerHTML|outerHTML|dangerouslySetInnerHTML|insertAdjacentHTML)\b|new\s+Function\s*\(|(?<![.\w])eval\s*\(/);
      if (c.includes('set:html')) expect(['layouts/Base.astro'].some((ok) => f.endsWith(ok)), f).toBe(true);
    }
  });

  it('no hay tasas de cambio ni precios en el código', () => {
    for (const [f, c] of fuentes(CODIGO)) {
      if (f.endsWith('contenido/ejemplo.ts')) continue; // el ejemplo trae precios BASE en USD, no tasas
      expect(c, f).not.toMatch(/\b6[.,]96\b|\b160[.,]2\b|bobPerUsd|arsPerBob|DEFAULT_RATES|toCur\(/);
    }
  });

  it('no usa CDN ni fuentes remotas y no hay estilos en línea (la CSP los bloquea)', () => {
    for (const [f, c] of fuentes(CODIGO)) {
      expect(c, f).not.toMatch(/unpkg\.com|jsdelivr|cdnjs|fonts\.googleapis|fonts\.gstatic/);
      expect(c, f).not.toMatch(/\sstyle\s*=\s*["'{]/);
    }
  });

  it('todo enlace con target=_blank lleva noopener', () => {
    for (const [f, c] of fuentes(/\.(tsx|astro)$/)) {
      for (const m of c.matchAll(/<a\b[^>]*target=\{?["']?_blank/g)) {
        const etiqueta = c.slice(m.index, c.indexOf('>', m.index + 1) + 200);
        expect(etiqueta, f).toMatch(/noopener/);
      }
    }
  });

  it('el texto público usa tuteo, no voseo', () => {
    const voseo = /\b(mirá|revisá|tocá|volvé|dejá|entrá|escribí|elegí|podés|tenés|querés|sabés|hacé|vos|seleccioná|conocé|explorá|comunicate|coordiná|consultá|contanos|escribinos)\b/i;
    for (const [f, c] of fuentes(CODIGO, true)) expect(c, f).not.toMatch(voseo);
  });

  it('no hay ingreso de administración ni chat simulado en el sitio público', () => {
    for (const [f, c] of fuentes(CODIGO)) {
      expect(c, f).not.toMatch(/Panel de Administraci|Iniciar Sesi|adminUser|adminPass|chatSent|sendChat/i);
    }
  });

  it('las afirmaciones sin confirmar no se publican por defecto', () => {
    for (const [f, c] of fuentes(/\.astro$/)) {
      if (c.includes('afirmacionVisible')) expect(c, f).toMatch(/afirmacionVisible\([^)]*,\s*false\)/);
    }
  });

  it('el medidor solo se carga desde la configuración: ningún identificador de píxel en el código', () => {
    for (const [f, c] of fuentes(CODIGO)) {
      if (f.endsWith('contenido/ejemplo.ts')) continue;
      expect(c, f).not.toMatch(/\bG-[A-Z0-9]{8,}\b|\b\d{15,16}\b|\bC[A-Z0-9]{18}\b/);
    }
  });

  it('el sitio no menciona al cliente (el repositorio es público)', () => {
    for (const [f, c] of fuentes(/\.(ts|tsx|astro|css|js|json|md)$/, true)) expect(c.toLowerCase(), f).not.toContain('bermejo');
  });
});
