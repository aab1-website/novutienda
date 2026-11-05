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

// LA CSP DEL PANEL LA DEFINE ESTE BUILD (única fuente de verdad): `_cabeceras.json` se incorpora al target `panel` de
// dist/firebase.json con plataforma/funciones/scripts/componer-hosting.mjs, igual que el sitio. La sección del target
// `panel` de firebase.json versionado es solo su valor base y una prueba (pruebas/panel/cabeceras.test.ts) exige que
// coincida con lo que genera este script.
// Sin 'unsafe-inline' ni 'unsafe-eval'. Solo lo que el panel usa en producción:
//   connect-src identitytoolkit y securetoken (Firebase Auth), las funciones (callables, región us-east1) y
//               firebasestorage.googleapis.com (subidas).
//               Funciones: el SDK de callables (@firebase/functions) llama SIEMPRE a
//               https://<región>-<proyecto>.cloudfunctions.net/<función>, así que NO hace falta *.a.run.app. Con
//               VITE_FIREBASE_PROJECT_ID se sella el host exacto https://us-east1-<proyecto>.cloudfunctions.net; sin la
//               variable (valor base del firebase.json versionado y compilaciones locales) el respaldo es el comodín
//               https://*.cloudfunctions.net, porque CSP no admite comodines a mitad de un nombre («us-east1-*»).
//   img-src / media-src  Cloud Storage (medios publicados) y blob: (vistas previas antes de subir). Con
//               VITE_FIREBASE_STORAGE_BUCKET se restringen al prefijo de ese bucket (https://storage.googleapis.com/<bucket>/
//               y, solo en img-src, https://firebasestorage.googleapis.com/v0/b/<bucket>/); sin la variable, los hosts completos.
// App Check con reCAPTCHA Enterprise (única razón de estos dominios):
//   script-src  https://www.google.com/recaptcha/ y https://www.gstatic.com/recaptcha/  (enterprise.js y sus módulos)
//   connect-src https://content-firebaseappcheck.googleapis.com (canje del token) y https://www.google.com (recaptcha/enterprise/reload y clr)
//   frame-src   https://www.google.com y https://recaptcha.google.com  (marco invisible de reCAPTCHA Enterprise)
// La compilación `--emulador` NO los incluye: usa un proveedor propio y no carga nada de Google.
// Las variables llegan del entorno del build (el CI las exporta para el panel). Se validan: van dentro de la CSP y un valor
// con espacios o «;» abriría o rompería directivas. En la compilación del emulador no se usan.
const PROYECTO = emulador ? '' : (process.env.VITE_FIREBASE_PROJECT_ID ?? '').trim();
const BUCKET = emulador ? '' : (process.env.VITE_FIREBASE_STORAGE_BUCKET ?? '').trim();
if (PROYECTO !== '' && !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(PROYECTO)) {
  console.error('sellar: VITE_FIREBASE_PROJECT_ID no tiene la forma de un id de proyecto de Google Cloud.');
  process.exit(1);
}
if (BUCKET !== '' && !/^[a-z0-9][a-z0-9._-]{2,221}$/.test(BUCKET)) {
  console.error('sellar: VITE_FIREBASE_STORAGE_BUCKET no tiene la forma de un nombre de bucket.');
  process.exit(1);
}
const FUNCIONES = PROYECTO === '' ? 'https://*.cloudfunctions.net' : `https://us-east1-${PROYECTO}.cloudfunctions.net`;
const ALMACEN_IMG = BUCKET === '' ? 'https://storage.googleapis.com https://firebasestorage.googleapis.com' : `https://storage.googleapis.com/${BUCKET}/ https://firebasestorage.googleapis.com/v0/b/${BUCKET}/`;
const ALMACEN_MEDIA = BUCKET === '' ? 'https://storage.googleapis.com' : `https://storage.googleapis.com/${BUCKET}/`;
const RECAPTCHA_SCRIPT = emulador ? '' : ' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/';
const RECAPTCHA_CONEXION = emulador ? '' : ' https://content-firebaseappcheck.googleapis.com https://www.google.com';
const RECAPTCHA_MARCO = emulador ? "'none'" : 'https://www.google.com https://recaptcha.google.com';
const CONEXIONES_EMULADOR = emulador ? ' http://127.0.0.1:8240 http://127.0.0.1:8243 http://127.0.0.1:8245' : '';
const csp = [
  "default-src 'none'",
  `script-src 'self'${RECAPTCHA_SCRIPT}`,
  "style-src 'self'",
  `img-src 'self' data: blob: ${ALMACEN_IMG}`,
  "font-src 'self'",
  `connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com ${FUNCIONES} https://firebasestorage.googleapis.com${RECAPTCHA_CONEXION}${CONEXIONES_EMULADOR}`,
  `frame-src ${RECAPTCHA_MARCO}`,
  "object-src 'none'",
  `media-src 'self' blob: ${ALMACEN_MEDIA}`,
  "manifest-src 'self'",
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
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cache-Control', value: 'no-store' },
];
writeFileSync(join(dir, '_cabeceras.json'), `${JSON.stringify([{ source: '**', headers }], null, 2)}\n`, 'utf8');
console.log(`sellar: ${dir}/_cabeceras.json escrito (CSP sin scripts ni estilos en línea)`);
