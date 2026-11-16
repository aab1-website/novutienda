// Pruebas sobre el dist del sitio REAL (contenido publicado de un tenant, no el de ejemplo). Se omiten salvo que
// estén EXIGIR_DIST o SITIO_CONTENIDO (el CI del sitio por tenant los fija tras compilar con el JSON de `contenido-sitio.mjs generar`).
// Entorno: MEDIOS_BASE_URL (origen https de los medios, obligatorio al correr), APP_ENV (staging por omisión, como `pnpm build`)
// y SITIO_CONTENIDO (el JSON con que se compiló: de él salen las expectativas sobre productos y fotos; el sitio puede quedar con
// cero productos o con productos sin fotos, y la prueba no lo trata como fallo).
//
// Procedimiento repetible con otro contenido SIN pisar dist/website: compilar a un directorio aparte (en el mismo disco que el repositorio,
// por ejemplo dist/prueba-x, ya ignorado por git; Astro no puede mover archivos entre discos) y apuntar la prueba a él.
//   SITIO_OUT_DIR=$PWD/dist/prueba-x SITIO_CONTENIDO=/ruta/contenido.json APP_ENV=staging MEDIOS_BASE_URL=https://medios.invalid \
//     pnpm --filter @novutienda/website run build
//   SITIO_OUT_DIR=$PWD/dist/prueba-x SITIO_CONTENIDO=/ruta/contenido.json MEDIOS_BASE_URL=https://medios.invalid EXIGIR_DIST=1 \
//     pnpm vitest run pruebas/website/dist-real.test.ts
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ARCHIVO_CABECERAS } from '@novutienda/website';

const DIST = process.env['SITIO_OUT_DIR'] || fileURLToPath(new URL('../../dist/website', import.meta.url));
const activo = process.env['EXIGIR_DIST'] !== undefined || process.env['SITIO_CONTENIDO'] !== undefined;
const ambiente = process.env['APP_ENV'] || 'staging';

interface ProductoReal { slug: string; fotos: { url: string }[] }
/** Productos del contenido con que se compiló; `null` si no se indicó SITIO_CONTENIDO (entonces se exige el caso normal). */
function productosDelContenido(): ProductoReal[] | null {
  const ruta = process.env['SITIO_CONTENIDO'];
  if (ruta === undefined || ruta === '') return null;
  return (JSON.parse(readFileSync(ruta, 'utf8')) as { productos: ProductoReal[] }).productos;
}

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

  it('el catálogo es coherente con el contenido: una ficha por producto, /productos siempre y el índice del buscador al día', () => {
    paginas();
    const productos = productosDelContenido();
    expect(existsSync(join(DIST, 'productos.html')), 'productos.html').toBe(true);
    const fichas = existsSync(join(DIST, 'producto')) ? html(join(DIST, 'producto')) : [];
    const indice = JSON.parse(readFileSync(join(DIST, 'indice-productos.json'), 'utf8')) as unknown[];
    if (productos === null) {
      expect(fichas.length).toBeGreaterThan(0);
      return;
    }
    expect(fichas.map((f) => f.slice(join(DIST, 'producto').length + 1, -'.html'.length)).sort()).toEqual(productos.map((p) => p.slug).sort());
    expect(indice).toHaveLength(productos.length);
    if (productos.length === 0) expect(indice).toEqual([]);
  });

  it('las imágenes de cada ficha de producto salen del origen de medios, y solo hay galería con fotos si el producto las tiene', () => {
    const base = origen();
    const productos = productosDelContenido();
    const conFoto = productos === null ? null : productos.filter((p) => p.fotos.length > 0);
    // Solo la galería de la ficha (no el logotipo de la cabecera): entre `class="galeria` y `class="ficha-info"`.
    const imagenesDe = (doc: string): string[] => {
      const ini = doc.indexOf('class="galeria');
      const fin = doc.indexOf('class="ficha-info"');
      const trozo = ini >= 0 && fin > ini ? doc.slice(ini, fin) : '';
      return [...trozo.matchAll(/<img\b[^>]*?\bsrc="([^"]+)"/g)].map((m) => m[1]!);
    };
    let total = 0;
    for (const f of paginas().filter((p) => p.startsWith(`${join(DIST, 'producto')}/`))) {
      const slug = f.slice(join(DIST, 'producto').length + 1, -'.html'.length);
      const imgs = imagenesDe(readFileSync(f, 'utf8'));
      for (const src of imgs) expect(src.startsWith(`${base}/`), `${f}: ${src}`).toBe(true);
      total += imgs.length;
      const p = productos?.find((x) => x.slug === slug);
      if (p !== undefined) {
        if (p.fotos.length > 0) expect(imgs.length, `${f}: el producto tiene fotos`).toBeGreaterThan(0);
        else expect(imgs, `${f}: el producto no tiene fotos`).toEqual([]);
      }
    }
    if (conFoto === null || conFoto.length > 0) expect(total).toBeGreaterThan(0);
    else expect(total).toBe(0);
  });
});
