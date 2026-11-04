// Verifica el dist/ y escribe las cabeceras de seguridad selladas (_cabeceras.json), como hace el sitio.
// Falla si el HTML contiene scripts o estilos en línea, manejadores de eventos, atributos style o recursos externos.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? '../../dist/panel');
// `--emulador`: SOLO la compilación de pruebas contra los emuladores de Firebase (http://127.0.0.1, puertos de firebase.json).
const emulador = process.argv.includes('--emulador');

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
// App Check con reCAPTCHA Enterprise (única razón de estos dominios; los mismos que firebase.json, target `panel`):
//   script-src  https://www.google.com/recaptcha/ y https://www.gstatic.com/recaptcha/  (enterprise.js y sus módulos)
//   connect-src https://firebaseappcheck.googleapis.com (canje del token) y https://www.google.com (recaptcha/enterprise/reload y clr)
//   frame-src   https://www.google.com y https://recaptcha.google.com  (marco invisible de reCAPTCHA Enterprise)
// La compilación `--emulador` NO los incluye: usa un proveedor propio y no carga nada de Google.
const RECAPTCHA_SCRIPT = emulador ? '' : ' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/';
const RECAPTCHA_CONEXION = emulador ? '' : ' https://firebaseappcheck.googleapis.com https://www.google.com';
const RECAPTCHA_MARCO = emulador ? "'none'" : 'https://www.google.com https://recaptcha.google.com';
const CONEXIONES_EMULADOR = emulador ? ' http://127.0.0.1:8240 http://127.0.0.1:8243 http://127.0.0.1:8245' : '';
const csp = [
  "default-src 'none'",
  `script-src 'self'${RECAPTCHA_SCRIPT}`,
  "style-src 'self'",
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  `connect-src 'self' https://*.cloudfunctions.net https://*.run.app https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firebasestorage.googleapis.com${RECAPTCHA_CONEXION}${CONEXIONES_EMULADOR}`,
  `frame-src ${RECAPTCHA_MARCO}`,
  "object-src 'none'",
  "media-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(emulador ? [] : ['upgrade-insecure-requests']),
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
