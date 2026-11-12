// Pruebas sobre el sitio ya compilado (`dist/website`, generado por `astro build`). Si todavía no se
// compiló, se omiten (`npm test` a secas) salvo con EXIGIR_DIST=1, que fija el CI en el paso posterior al build:
// entonces la ausencia de dist/website es un fallo, nunca una omisión en silencio.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ARCHIVO_CABECERAS, ESTILO_ISLAS, estilosEnLinea, hashDe, scriptsEnLinea, verificarDist } from '@novutienda/website';

const DIST = fileURLToPath(new URL('../../dist/website', import.meta.url));
const compilado = existsSync(join(DIST, ARCHIVO_CABECERAS));
const exigido = process.env['EXIGIR_DIST'] === '1';

describe('sitio compilado exigido', () => {
  it('existe dist/website cuando se exige (EXIGIR_DIST=1)', () => {
    if (exigido) expect(compilado, 'EXIGIR_DIST=1 pero falta dist/website: compile antes con `pnpm build`').toBe(true);
    else expect(true).toBe(true);
  });
});

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

  it('la ficha pinta la descripción con elementos reales, escapada y sin saltar niveles; la tarjeta usa texto plano', () => {
    const ficha = readFileSync(join(DIST, 'producto/televisor-ejemplo-55.html'), 'utf8');
    const desc = /<div class="ficha-descripcion">([\s\S]*?)<\/div>\s*(?:<p class="ficha-garantia"|<\/div>)/.exec(ficha)?.[1] ?? '';
    expect(desc).toContain('<h2 class="descripcion-titulo">Características</h2>');
    expect(desc).toContain('<h3 class="descripcion-titulo">Conexiones</h3>');
    expect(desc).toMatch(/<ul class="descripcion-lista"><li>Pantalla de <strong>55 pulgadas<\/strong><\/li><li>Resolución 4K<\/li><\/ul>/);
    expect(desc).toContain('&lt;b&gt;Texto literal&lt;/b&gt;');
    expect(desc).not.toMatch(/##|\* |<b>/);
    expect((ficha.match(/<h1[\s>]/g) ?? []).length).toBe(1);
    const lista = readFileSync(join(DIST, 'productos/televisores.html'), 'utf8');
    const tarjeta = /<p class="tarjeta-descripcion">([^<]*)<\/p>/.exec(lista)?.[1] ?? '';
    expect(tarjeta).not.toMatch(/#|\*/);
  });

  it('declara de qué contenido se compiló: /version-contenido.json con conteos y huella', () => {
    const v = JSON.parse(readFileSync(join(DIST, 'version-contenido.json'), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(v).sort()).toEqual(['esquema', 'huella', 'huellaSinDisponibilidad', 'productos', 'publicadoEn', 'secciones', 'version']);
    expect(v['esquema']).toBe(2);
    expect(v['huella']).toMatch(/^[0-9a-f]{64}$/);
    expect(v['huellaSinDisponibilidad']).toMatch(/^[0-9a-f]{64}$/);
    expect(v['productos']).toBeGreaterThan(0);
  });

  it('el carrusel de la portada con enlace lo pinta como enlace con nombre accesible', () => {
    const portada = readFileSync(join(DIST, 'index.html'), 'utf8');
    expect(portada).toMatch(/<a [^>]*class="carrusel-enlace activa"[^>]*href="\/productos"[^>]*aria-label="[^"]+"|<a [^>]*href="\/productos"[^>]*class="carrusel-enlace activa"/);
  });
});
