// Verifica el dist/ y escribe las cabeceras de seguridad selladas (_cabeceras.json), como hace el sitio.
// Falla si el HTML contiene scripts o estilos en línea, manejadores de eventos, atributos style o recursos externos.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? '../../dist/panel');

function* archivos(d, ext) {
  for (const n of readdirSync(d)) {
    const r = join(d, n);
    if (statSync(r).isDirectory()) yield* archivos(r, ext);
    else if (ext.includes(extname(n))) yield r;
  }
}

const problemas = [];
const falla = (f, m) => problemas.push(`${relative(dir, f)}: ${m}`);
for (const f of archivos(dir, ['.html'])) {
  const html = readFileSync(f, 'utf8');
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/type\s*=\s*["']?application\/(ld\+)?json/i.test(m[1] ?? '')) falla(f, 'script en línea');
  }
  if (/<style[\s>]/i.test(html)) falla(f, 'etiqueta <style> en línea');
  if (/\son[a-z]+\s*=\s*["']/i.test(html)) falla(f, 'manejador de eventos en línea');
  if (/\sstyle\s*=\s*["']/i.test(html)) falla(f, 'atributo style en línea');
  for (const m of html.matchAll(/(?:\bsrc|\bhref|\baction)\s*=\s*["'](https?:)?\/\/([^/"'?#\s]+)/gi)) falla(f, `recurso externo: ${m[2]}`);
}
for (const f of archivos(dir, ['.css'])) {
  const css = readFileSync(f, 'utf8');
  if (/url\(\s*["']?(https?:)?\/\//i.test(css) || /@import\s+(?:url\()?["']?https?:/i.test(css)) falla(f, 'CSS con recurso externo');
}
if (problemas.length > 0) {
  console.error(`El panel incumple la CSP:\n - ${problemas.join('\n - ')}`);
  process.exit(1);
}

// Sin 'unsafe-inline' ni 'unsafe-eval'. connect-src: callables (Cloud Functions), Firebase Auth y Cloud Storage.
const csp = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  "connect-src 'self' https://*.cloudfunctions.net https://*.run.app https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firebasestorage.googleapis.com",
  "frame-src 'none'",
  "object-src 'none'",
  "media-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

const headers = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cache-Control', value: 'no-store' },
];
writeFileSync(join(dir, '_cabeceras.json'), `${JSON.stringify([{ source: '**', headers }], null, 2)}\n`, 'utf8');
console.log(`sellar: ${dir}/_cabeceras.json escrito (CSP sin scripts ni estilos en línea)`);
