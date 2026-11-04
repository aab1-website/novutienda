import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConfigMedicion } from '../contenido/tipos.js';
import { jsonLdOrganizacion, jsonLdProducto, jsonLdSeguro, rutaCategoria, rutaProducto, rutaSeccion, tituloPagina, urlAbsoluta } from '../lib/seo.js';
import { contenidoEjemplo } from '../contenido/ejemplo.js';
import { manifiestoWebsite } from '../manifiesto.js';
import { cabecerasSeguridad, construirCsp } from './csp.js';
import { ARCHIVO_CABECERAS, ESTILO_ISLAS, estilosEnLinea, hashDe, hashesDeDist, hashesEstiloDeDist, scriptsEnLinea, sellarDist, verificarDist } from './sellar.js';
import { integracionSellarCsp } from '../integraciones/sellar-csp.js';
import { pathToFileURL } from 'node:url';

const nada: ConfigMedicion = { google: null, searchConsole: null, meta: null, tiktok: null };
const todo: ConfigMedicion = { google: 'G-EJEMPLO00', searchConsole: null, meta: '1234567890123456', tiktok: 'CEJEMPLO0000EJEMPLO' };

describe('CSP', () => {
  it('sin proveedores configurados no admite ningún origen externo', () => {
    const csp = construirCsp({ hashesScript: ["'sha256-abc='"], medicion: nada, recaptcha: false, origenMedios: null });
    expect(csp).not.toMatch(/https?:/);
    expect(csp).toContain("script-src 'self' 'sha256-abc='");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
  it('nunca incluye unsafe-inline ni unsafe-eval', () => {
    const csp = construirCsp({ hashesScript: [], medicion: todo, recaptcha: true, origenMedios: 'https://medios.ejemplo.invalid' });
    expect(csp).not.toMatch(/unsafe-/);
    expect(csp).not.toMatch(/unpkg|jsdelivr|cdnjs|fonts\.googleapis|fonts\.gstatic/);
  });
  it('solo agrega los orígenes de los proveedores configurados', () => {
    const soloMeta = construirCsp({ hashesScript: [], medicion: { ...nada, meta: '1234567890123456' }, recaptcha: false, origenMedios: null });
    expect(soloMeta).toContain('https://connect.facebook.net');
    expect(soloMeta).not.toContain('tiktok');
    expect(soloMeta).not.toContain('googletagmanager');
    const conMedios = construirCsp({ hashesScript: [], medicion: nada, recaptcha: true, origenMedios: 'https://medios.ejemplo.invalid' });
    expect(conMedios).toContain("img-src 'self' data: https://medios.ejemplo.invalid");
    expect(conMedios).toContain("media-src 'self' https://medios.ejemplo.invalid");
    expect(conMedios).toContain('https://www.google.com/recaptcha/');
  });
  it('las cabeceras acompañantes incluyen HSTS, nosniff y Referrer-Policy', () => {
    const k = cabecerasSeguridad('x').map((h) => h.key);
    expect(k).toEqual(expect.arrayContaining(['Content-Security-Policy', 'Strict-Transport-Security', 'X-Content-Type-Options', 'Referrer-Policy', 'X-Frame-Options']));
  });
});

describe('sellado y verificación del dist', () => {
  const dirs: string[] = [];
  const nuevo = (archivos: Record<string, string>): string => {
    const dir = mkdtempSync(join(tmpdir(), 'sitio-'));
    dirs.push(dir);
    for (const [ruta, contenido] of Object.entries(archivos)) {
      mkdirSync(join(dir, ruta, '..'), { recursive: true });
      writeFileSync(join(dir, ruta), contenido);
    }
    return dir;
  };
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  const pagina = (cuerpo: string): string => `<!doctype html><html><head><title>x</title></head><body>${cuerpo}</body></html>`;

  it('extrae los scripts ejecutables y excluye los bloques JSON y los externos', () => {
    const html = pagina('<script>a()</script><script src="/x.js"></script><script type="application/json">{}</script><script type="application/ld+json">{}</script>');
    expect(scriptsEnLinea(html)).toEqual(['a()']);
    expect(estilosEnLinea('<style>a{}</style>')).toEqual(['a{}']);
  });

  it('sella: escribe _cabeceras.json con el hash exacto de cada script en línea', () => {
    const dir = nuevo({ 'index.html': pagina('<script>uno()</script>'), 'a/b.html': pagina(`<script>uno()</script><script>dos()</script><style>${ESTILO_ISLAS}</style>`) });
    expect(hashesDeDist(dir)).toEqual([hashDe('dos()'), hashDe('uno()')].sort());
    expect(hashesEstiloDeDist(dir)).toEqual([hashDe(ESTILO_ISLAS)]);
    const csp = sellarDist(dir, { medicion: nada, recaptcha: false, origenMedios: null });
    expect(csp).toContain(hashDe('uno()'));
    expect(csp).toContain(`style-src 'self' ${hashDe(ESTILO_ISLAS)}`);
    const escrito = JSON.parse(readFileSync(join(dir, ARCHIVO_CABECERAS), 'utf8')) as { source: string; headers: { key: string; value: string }[] }[];
    expect(escrito[0]?.source).toBe('**');
    expect(escrito[0]?.headers[0]).toEqual({ key: 'Content-Security-Policy', value: csp });
  });

  it('un contenido distinto da un hash distinto (el sello no puede quedar viejo)', () => {
    expect(hashDe('a()')).not.toBe(hashDe('b()'));
  });

  it('detecta lo que la CSP bloquearía en silencio', () => {
    const dir = nuevo({
      'mala.html': pagina('<button onclick="x()">a</button><div style="color:red">b</div><style>.x{}</style><a href="javascript:x()">c</a><a href="https://otro.example/" target="_blank">d</a><img src="https://cdn.otro.example/a.png">'),
      'estilo.css': '@import url("https://fonts.googleapis.com/css");\nbody{background:url(https://cdn.example/a.png)}',
    });
    const motivos = verificarDist(dir, []).map((p) => p.motivo).join('\n');
    expect(motivos).toContain('manejador de eventos');
    expect(motivos).toContain('atributo style');
    expect(motivos).toContain('<style> en línea no autorizada');
    expect(motivos).toContain('javascript:');
    expect(motivos).toContain('sin noopener');
    expect(motivos).toContain('cdn.otro.example');
    expect(motivos).toContain('CSS carga un recurso externo');
    expect(motivos).toContain('@import externo');
  });

  it('acepta un sitio limpio con enlaces externos bien declarados y datos JSON-LD', () => {
    const dir = nuevo({
      'index.html': pagina('<a href="https://wa.me/591" target="_blank" rel="noopener noreferrer">wa</a><script type="application/ld+json">{"url":"https://schema.org"}</script><script type="application/json" id="cb-config" onload="x">{}</script>'),
    });
    expect(verificarDist(dir, ['wa.me'])).toEqual([]);
  });

  it('la integración falla el build si hay problemas y sella si no', () => {
    const malo = nuevo({ 'index.html': pagina('<div style="x:y">a</div>') });
    const integ = integracionSellarCsp({ medicion: nada, recaptcha: false, origenMedios: null });
    expect(() => integ.hooks['astro:build:done']({ dir: pathToFileURL(`${malo}/`) })).toThrow(/CSP/);
    const bueno = nuevo({ 'index.html': pagina('<script>x()</script>') });
    integ.hooks['astro:build:done']({ dir: pathToFileURL(`${bueno}/`) });
    expect(readFileSync(join(bueno, ARCHIVO_CABECERAS), 'utf8')).toContain(hashDe('x()'));
  });
});

describe('SEO y JSON-LD', () => {
  const c = contenidoEjemplo;
  const tv = c.productos[0]!;
  it('arma rutas y URL absolutas', () => {
    expect(rutaProducto(tv)).toBe('/producto/televisor-ejemplo-55');
    expect(rutaCategoria('aires')).toBe('/productos/aires');
    expect(rutaSeccion('garantia')).toBe('/seccion/garantia');
    expect(urlAbsoluta('https://x.example', '/a')).toBe('https://x.example/a');
    expect(urlAbsoluta('https://x.example', 'a')).toBe('https://x.example/a');
    expect(tituloPagina('A', 'B')).toBe('A | B');
  });
  it('Product/Offer: precio en USD por mercado, disponibilidad y marca', () => {
    const ld = jsonLdProducto(tv, c) as { '@type': string; offers: { price: string; priceCurrency: string; availability: string }[]; sku: string; image: string[] };
    expect(ld['@type']).toBe('Product');
    expect(ld.sku).toBe('ejemplo-tv-55');
    expect(ld.offers.map((o) => o.price)).toEqual(['450.00', '480.00']);
    expect(ld.offers.every((o) => o.priceCurrency === 'USD')).toBe(true);
    expect(ld.offers[0]?.availability).toBe('https://schema.org/InStock');
    expect(ld.image[0]).toBe('https://ejemplo.invalid/ejemplo/producto-1.svg');
  });
  it('con precio 0 no hay oferta; agotado se declara; sin garantía ni fotos se omiten', () => {
    const sinPrecio = jsonLdProducto({ ...tv, precioUsd: { BO: 0, AR: 0 }, disponible: false, garantia: null, fotos: [] }, c);
    expect(sinPrecio).not.toHaveProperty('offers');
    expect(sinPrecio).not.toHaveProperty('warranty');
    expect(sinPrecio).not.toHaveProperty('image');
    const agotado = jsonLdProducto({ ...tv, disponible: false }, c) as { offers: { availability: string }[] };
    expect(agotado.offers[0]?.availability).toBe('https://schema.org/OutOfStock');
  });
  it('jsonLdSeguro nunca puede cerrar la etiqueta <script>', () => {
    const s = jsonLdSeguro({ a: '</script><script>alert(1)</script>', b: '&' });
    expect(s).not.toContain('<');
    expect(JSON.parse(s)).toEqual({ a: '</script><script>alert(1)</script>', b: '&' });
  });
  it('organización con datos del negocio', () => {
    expect(jsonLdOrganizacion(c)).toMatchObject({ '@type': 'Store', name: 'Tienda de Ejemplo' });
  });
});

describe('manifiesto', () => {
  it('declara solo sus colecciones (contactos), con escritura de servidor, y ningún dato de otro módulo', () => {
    const rutas = manifiestoWebsite.colecciones.map((x) => x.ruta);
    expect(rutas).toEqual(['contactos']);
    expect(manifiestoWebsite.colecciones.every((x) => x.escritura === 'servidor')).toBe(true);
    for (const ajeno of ['productos', 'existencias', 'existenciasPublicas', 'cotizaciones', 'fichasWeb', 'publicado']) expect(rutas).not.toContain(ajeno);
  });
});
