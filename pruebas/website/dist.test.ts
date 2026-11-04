// Pruebas sobre el sitio ya compilado (`dist/website`, generado por `astro build`). Si todavía no se
// compiló, se omiten y lo dicen: la compilación forma parte de la verificación del módulo.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ARCHIVO_CABECERAS, ESTILO_ISLAS, estilosEnLinea, hashDe, scriptsEnLinea, verificarDist } from '@novutienda/website';

const DIST = fileURLToPath(new URL('../../dist/website', import.meta.url));
const compilado = existsSync(join(DIST, ARCHIVO_CABECERAS));

function html(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const r = join(dir, n);
    return statSync(r).isDirectory() ? html(r) : r.endsWith('.html') ? [r] : [];
  });
}

describe.skipIf(!compilado)('CSP del sitio compilado', () => {
  const cabeceras = (): Record<string, string> =>
    Object.fromEntries((JSON.parse(readFileSync(join(DIST, ARCHIVO_CABECERAS), 'utf8')) as { headers: { key: string; value: string }[] }[])[0]!.headers.map((h) => [h.key, h.value]));

  it('cada script en línea de cada página tiene su hash en script-src, y cada estilo en línea el suyo', () => {
    const csp = cabeceras()['Content-Security-Policy']!;
    const scriptSrc = /script-src ([^;]+)/.exec(csp)![1]!;
    const styleSrc = /style-src ([^;]+)/.exec(csp)![1]!;
    let scripts = 0;
    for (const f of html(DIST)) {
      const doc = readFileSync(f, 'utf8');
      for (const s of scriptsEnLinea(doc)) {
        scripts += 1;
        expect(scriptSrc, f).toContain(hashDe(s));
      }
      for (const s of estilosEnLinea(doc)) {
        expect(s).toBe(ESTILO_ISLAS);
        expect(styleSrc).toContain(hashDe(s));
      }
    }
    expect(scripts).toBeGreaterThan(0);
  });

  it('la política es estricta: sin unsafe-inline, sin unsafe-eval y sin CDN', () => {
    const csp = cabeceras()['Content-Security-Policy']!;
    expect(csp).not.toMatch(/unsafe-/);
    expect(csp).not.toMatch(/unpkg|jsdelivr|cdnjs|fonts\.googleapis|fonts\.gstatic/);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('el HTML no trae manejadores en línea, estilos en línea, dominios externos no declarados ni enlaces sin noopener', () => {
    const permitidos = ['wa.me', 'ejemplo.invalid', 'www.ejemplo.invalid'];
    expect(verificarDist(DIST, permitidos)).toEqual([]);
  });

  it('las 22 páginas esperadas existen: portada, catálogo, categorías, fichas, contacto, privacidad, 404 y secciones', () => {
    for (const f of ['index', 'productos', 'contacto', 'privacidad', '404', 'productos/televisores', 'producto/televisor-ejemplo-55', 'seccion/como-comprar']) {
      expect(existsSync(join(DIST, `${f}.html`)), f).toBe(true);
    }
    expect(html(DIST)).toHaveLength(22);
  });

  it('la portada tiene un solo h1 y título real; ninguna página trae marcadores de pendiente publicados', () => {
    for (const f of html(DIST)) {
      const doc = readFileSync(f, 'utf8');
      expect((doc.match(/<h1[\s>]/g) ?? []).length, f).toBe(1);
      expect(doc, f).toMatch(/<title>[^<]{3,}<\/title>/);
      expect(doc, f).not.toMatch(/CONFIRMAR/);
      expect(doc, f).not.toContain('+5,000');
    }
  });

  it('la hoja de plantillas se publica como archivo propio con las 5 plantillas', () => {
    const css = readFileSync(join(DIST, 'plantillas.css'), 'utf8');
    for (const id of ['cielo', 'bosque', 'ambar', 'grafito', 'ciruela']) expect(css).toContain(`data-plantilla="${id}"`);
  });
});
