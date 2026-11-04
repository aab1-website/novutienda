// La CSP del panel la define su build (paquetes/panel/scripts/sellar.mjs). Estas pruebas fijan su contenido, exigen que el
// firebase.json versionado coincida con lo que genera el build (una sola fuente de verdad) y que componer-hosting.mjs
// incorpore el sello del panel, igual que el del sitio.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { componer } from '../../plataforma/funciones/scripts/componer-hosting.mjs';

type Cab = { key: string; value: string };
type Firebase = { hosting: { target: string; headers: { source: string; headers: Cab[] }[] }[] };

const raiz = mkdtempSync(join(tmpdir(), 'sello-panel-'));
afterAll(() => rmSync(raiz, { recursive: true, force: true }));

function sellar(nombre: string, ...extra: string[]): Cab[] {
  const dir = join(raiz, nombre);
  mkdirSync(dir);
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="app"></div></body></html>');
  execFileSync('node', ['paquetes/panel/scripts/sellar.mjs', dir, ...extra], { stdio: 'pipe' });
  const [regla] = JSON.parse(readFileSync(join(dir, '_cabeceras.json'), 'utf8')) as { source: string; headers: Cab[] }[];
  return regla?.headers ?? [];
}
const valor = (h: Cab[], clave: string): string => h.find((x) => x.key === clave)?.value ?? '';
const directiva = (csp: string, nombre: string): string[] => (csp.split(';').map((d) => d.trim().split(/\s+/)).find((d) => d[0] === nombre) ?? []).slice(1);
const versionado = JSON.parse(readFileSync('firebase.json', 'utf8')) as Firebase;
const reglaDe = (f: Firebase, target: string): Cab[] => f.hosting.find((h) => h.target === target)?.headers.find((r) => r.source === '**')?.headers ?? [];

describe('CSP del panel (producción)', () => {
  const h = sellar('produccion');
  const csp = valor(h, 'Content-Security-Policy');

  it('permite solo lo que el panel usa', () => {
    expect(directiva(csp, 'default-src')).toEqual(["'none'"]);
    expect(directiva(csp, 'connect-src').sort()).toEqual([
      "'self'", 'https://*.a.run.app', 'https://*.cloudfunctions.net', 'https://firebaseappcheck.googleapis.com', 'https://firebasestorage.googleapis.com',
      'https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com', 'https://www.google.com',
    ].sort());
    expect(directiva(csp, 'img-src')).toEqual(["'self'", 'data:', 'blob:', 'https://storage.googleapis.com', 'https://firebasestorage.googleapis.com']);
    expect(directiva(csp, 'media-src')).toEqual(["'self'", 'blob:', 'https://storage.googleapis.com']);
    expect(directiva(csp, 'manifest-src')).toEqual(["'self'"]);
    expect(directiva(csp, 'script-src')).toEqual(["'self'", 'https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/']);
    expect(directiva(csp, 'frame-src')).toEqual(['https://www.google.com', 'https://recaptcha.google.com']);
    expect(directiva(csp, 'frame-ancestors')).toEqual(["'none'"]);
    expect(csp).toContain('upgrade-insecure-requests');
  });
  it('sin unsafe-*, sin esquemas abiertos, sin Firestore ni http', () => {
    expect(csp).not.toMatch(/unsafe-|\shttps:(\s|;|$)|\sdata:\s*\*|http:|firestore\.googleapis/);
  });
  it('cabeceras de endurecimiento', () => {
    expect(valor(h, 'Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains');
    expect(valor(h, 'Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    // reCAPTCHA Enterprise de App Check usa un marco invisible, no ventanas emergentes: no hace falta relajar el aislamiento.
    expect(valor(h, 'Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(valor(h, 'X-Frame-Options')).toBe('DENY');
    expect(valor(h, 'Cache-Control')).toBe('no-store');
  });
  it('el firebase.json versionado coincide con lo que genera el build (una sola fuente de verdad)', () => {
    expect(reglaDe(versionado, 'panel')).toEqual(h);
  });
});

describe('CSP del panel (compilación para el emulador)', () => {
  const csp = valor(sellar('emulador', '--emulador'), 'Content-Security-Policy');
  it('no carga nada de Google y solo conecta a los puertos de los emuladores', () => {
    expect(csp).not.toMatch(/recaptcha|gstatic|www\.google\.com|appcheck|upgrade-insecure/);
    expect(directiva(csp, 'connect-src')).toEqual(expect.arrayContaining(['http://127.0.0.1:8240', 'http://127.0.0.1:8243', 'http://127.0.0.1:8245']));
    expect(directiva(csp, 'frame-src')).toEqual(["'none'"]);
  });
});

describe('componer-hosting con el sello del panel', () => {
  const sitio = [{ source: '**', headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'; script-src 'self' 'sha256-abc='" }] }];
  const panel = [{ source: '**', headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'; connect-src 'self'" }, { key: 'X-Frame-Options', value: 'DENY' }] }];

  it('sustituye la regla ** de cada target y deja intactas las demás reglas', () => {
    const r = componer(versionado, sitio, panel) as Firebase;
    expect(reglaDe(r, 'sitio')).toEqual(sitio[0]?.headers);
    expect(reglaDe(r, 'panel')).toEqual(panel[0]?.headers);
    const original = versionado.hosting.find((x) => x.target === 'panel')?.headers.filter((x) => x.source !== '**');
    expect(r.hosting.find((x) => x.target === 'panel')?.headers.filter((x) => x.source !== '**')).toEqual(original);
    expect(reglaDe(versionado, 'panel')).not.toEqual(panel[0]?.headers);
  });
  it('con el sello real del build, dist/firebase.json solo difiere del versionado en la regla ** del sitio', () => {
    const r = componer(versionado, sitio, [{ source: '**', headers: sellar('real') }]) as Firebase;
    const sinSitio = (f: Firebase): unknown => ({ ...f, hosting: f.hosting.map((x) => (x.target === 'sitio' ? { ...x, headers: x.headers.filter((y) => y.source !== '**') } : x)) });
    expect(sinSitio(r)).toEqual(sinSitio(versionado));
  });
  it('rechaza un sello del panel sin CSP o con otra forma', () => {
    expect(() => componer(versionado, sitio, [{ source: '**', headers: [{ key: 'X-Frame-Options', value: 'DENY' }] }])).toThrow(/panel.*Content-Security-Policy/);
    expect(() => componer(versionado, sitio, [])).toThrow(/panel.*exactamente una regla/);
  });
  it('sin sello del panel conserva el comportamiento anterior (solo el sitio)', () => {
    const r = componer(versionado, sitio) as Firebase;
    expect(reglaDe(r, 'panel')).toEqual(reglaDe(versionado, 'panel'));
  });
});
