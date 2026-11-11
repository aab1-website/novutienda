// Pruebas sobre el dist del sitio REAL (contenido publicado de un tenant, no el de ejemplo). Se omiten salvo que
// estén EXIGIR_DIST o SITIO_CONTENIDO (el CI del sitio por tenant los fija tras compilar con el JSON de `contenido-sitio.mjs generar`).
// Entorno: MEDIOS_BASE_URL (origen https de los medios, obligatorio al correr) y APP_ENV (staging por omisión, como `pnpm build`).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ARCHIVO_CABECERAS } from '@novutienda/website';

const DIST = fileURLToPath(new URL('../../dist/website', import.meta.url));
const activo = process.env['EXIGIR_DIST'] !== undefined || process.env['SITIO_CONTENIDO'] !== undefined;
const ambiente = process.env['APP_ENV'] || 'staging';

function html(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const r = join(dir, n);
    return statSync(r).isDirectory() ? html(r) : r.endsWith('.html') ? [r] : [];
  });
}

describe.skipIf(!activo)('dist del sitio real (dist/website)', () => {
  const origen = (): string => {
    const m = process.env['MEDIOS_BASE_URL'];
    expect(m, 'falta MEDIOS_BASE_URL').toMatch(/^https:\/\/[^/?#\s]+/);
    return new URL(m!).origin;
  };
  const paginas = (): string[] => {
    expect(existsSync(join(DIST, ARCHIVO_CABECERAS)), 'falta dist/website: compile antes con `pnpm build`').toBe(true);
    const f = html(DIST);
    expect(f.length).toBeGreaterThan(0);
    return f;
  };

  it('ninguna página ni archivo de texto contiene «EJEMPLO»', () => {
    for (const f of paginas()) expect(readFileSync(f, 'utf8'), f).not.toMatch(/EJEMPLO/i);
  });

  it('en staging (o cualquier ambiente no productivo) cada página lleva meta noindex', () => {
    const fichas = paginas();
    for (const f of fichas) {
      const doc = readFileSync(f, 'utf8');
      if (ambiente === 'production') continue;
      expect(doc, f).toMatch(/<meta name="robots" content="[^"]*noindex/);
    }
  });

  it('el CSP del dist admite el origen de medios en img-src', () => {
    paginas();
    const cab = (JSON.parse(readFileSync(join(DIST, ARCHIVO_CABECERAS), 'utf8')) as { headers: { key: string; value: string }[] }[])[0]!.headers;
    const csp = cab.find((h) => h.key === 'Content-Security-Policy')!.value;
    const imgSrc = /img-src ([^;]+)/.exec(csp)![1]!.split(/\s+/);
    expect(imgSrc).toContain(origen());
  });

  it('las imágenes de las fichas de producto apuntan bajo el origen de medios', () => {
    const base = origen();
    let imagenes = 0;
    for (const f of paginas().filter((p) => p.includes(`${join(DIST, 'producto')}/`))) {
      for (const m of readFileSync(f, 'utf8').matchAll(/<img\b[^>]*?\bsrc="([^"]+)"/g)) {
        imagenes += 1;
        expect(m[1]!.startsWith(`${base}/`), `${f}: ${m[1]}`).toBe(true);
      }
    }
    expect(imagenes).toBeGreaterThan(0);
  });
});
