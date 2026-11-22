// .github/scripts/preparar-despliegue-firebase.sh frente a plataforma/funciones/servidor/config.ts: firebase-tools, en modo
// no interactivo, exige una línea en el dotenv para TODO parámetro defineString/defineBoolean/…, aunque tenga `default`
// (despliegue a staging roto tras #198, run 44982217190). Esta prueba lee los nombres de config.ts y corre el script real
// en un árbol mínimo (sustitutos de `firebase`, `sitios-tenant.mjs` y `empaquetar.mjs`): cada parámetro debe salir con
// exactamente una línea en staging y en production, y ningún defineSecret puede aparecer (los secretos viven en Secret
// Manager; un dotenv con el mismo nombre choca con el secreto en el despliegue).
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve('.github/scripts/preparar-despliegue-firebase.sh');
const CONFIG = readFileSync(resolve('plataforma/funciones/servidor/config.ts'), 'utf8');
const nombres = (patron: RegExp) => [...CONFIG.matchAll(patron)].map((m) => m[1] as string);
const PARAMETROS = nombres(/\bdefine(?:String|Boolean|Int|Float|List)\(\s*['"]([A-Z0-9_]+)['"]/g);
const SECRETOS = nombres(/\bdefineSecret\(\s*['"]([A-Z0-9_]+)['"]/g);

const BASE = 'https://medios.ejemplo.test';
const FIREBASE_JSON = {
  hosting: [
    { target: 'sitio', public: 'dist/website', headers: [{ source: '**', headers: [{ key: 'Content-Security-Policy', value: "default-src 'self'" }] }] },
    { target: 'panel', public: 'dist/panel', headers: [{ source: '**', headers: [{ key: 'Content-Security-Policy', value: `default-src 'self'; img-src 'self' ${BASE}/` }] }] },
  ],
};
const EMPAQUETAR = `import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync('dist/funciones', { recursive: true });
copyFileSync(process.env.FUNCIONES_PARAMETROS, 'dist/funciones/.env');
`;

const temporales: string[] = [];
afterEach(() => { for (const t of temporales.splice(0)) rmSync(t, { recursive: true, force: true }); });

function correr(ambiente: 'staging' | 'production', extra: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'preparar-cobertura-'));
  temporales.push(dir);
  for (const d of ['dist', 'scripts', 'plataforma/funciones/scripts', 'bin', 'runner']) mkdirSync(join(dir, d), { recursive: true });
  writeFileSync(join(dir, 'firebase.json'), JSON.stringify(FIREBASE_JSON));
  cpSync(join(dir, 'firebase.json'), join(dir, 'dist/firebase.json'));
  writeFileSync(join(dir, 'scripts/sitios-tenant.mjs'), 'process.exit(0);\n');
  writeFileSync(join(dir, 'plataforma/funciones/scripts/empaquetar.mjs'), EMPAQUETAR);
  writeFileSync(join(dir, 'bin/firebase'), '#!/usr/bin/env bash\nexit 0\n');
  chmodSync(join(dir, 'bin/firebase'), 0o755);
  const env: Record<string, string> = {
    PATH: `${join(dir, 'bin')}:${process.env['PATH'] ?? ''}`,
    RUNNER_TEMP: join(dir, 'runner'),
    AMBIENTE: ambiente,
    PROYECTO: 'proyecto-x',
    SITIO_ID: 'sitio-x',
    PANEL_ID: 'panel-x',
    PANEL_URL: 'https://panel-x.web.app',
    SOLO: 'functions',
    P_APP_CHECK_EXIGIDO: 'true',
    P_SITIO_URL: 'https://sitio-x.web.app',
    P_MEDIOS_BASE_URL: BASE,
    P_MEDIOS_BUCKET_PUBLICO: 'medios-publicos-x',
    VITE_MEDIOS_BASE_URL: BASE,
    ...extra,
  };
  const r = spawnSync('bash', [SCRIPT], { cwd: dir, env, encoding: 'utf8', timeout: 20_000 });
  let envFunciones = '';
  try { envFunciones = readFileSync(join(dir, 'dist/funciones/.env'), 'utf8'); } catch { /* sin archivo */ }
  const lineas = envFunciones.split('\n').filter(Boolean);
  const valor = (nombre: string) => lineas.find((l) => l.startsWith(`${nombre}=`))?.slice(nombre.length + 1);
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}`, lineas, valor };
}

describe('preparar-despliegue-firebase.sh cubre todos los parámetros de config.ts', () => {
  it('config.ts declara parámetros y secretos (el patrón de lectura sigue vigente)', () => {
    expect(PARAMETROS).toContain('CONSTRUCTOR_SITIO_MODO');
    expect(PARAMETROS).toContain('APP_CHECK_EXIGIDO');
    expect(SECRETOS.length).toBeGreaterThan(0);
  });

  for (const ambiente of ['staging', 'production'] as const) {
    it(`${ambiente}: una línea por parámetro y ningún secreto`, () => {
      const r = correr(ambiente);
      expect(r.codigo, r.salida).toBe(0);
      for (const nombre of PARAMETROS) {
        expect(r.lineas.filter((l) => l.startsWith(`${nombre}=`)), `falta ${nombre} en funciones.env`).toHaveLength(1);
      }
      for (const nombre of SECRETOS) {
        expect(r.lineas.some((l) => l.startsWith(`${nombre}=`)), `${nombre} es secreto`).toBe(false);
      }
      expect(r.valor('CONSTRUCTOR_SITIO_MODO')).toBe('github');
      expect(r.valor('CONSTRUCTOR_SITIO_APP_ENV')).toBe(ambiente);
      expect(r.valor('SITIO_PANEL_ID')).toBe('panel-x');
    });
  }
});

describe('preparar-despliegue-firebase.sh: interruptor del constructor', () => {
  it('staging pasa las variables públicas del sitio', () => {
    const r = correr('staging', { P_VITE_FIREBASE_API_KEY: 'clave-publica', P_VITE_FIREBASE_APP_ID: 'app-x' });
    expect(r.codigo, r.salida).toBe(0);
    expect(r.valor('VITE_FIREBASE_API_KEY')).toBe('clave-publica');
    expect(r.valor('VITE_FIREBASE_APP_ID')).toBe('app-x');
  });
  it('modo desconocido: falla cerrado', () => {
    expect(correr('staging', { P_CONSTRUCTOR_SITIO_MODO: 'otro' }).codigo).not.toBe(0);
  });
  it('production en modo google: falla cerrado', () => {
    expect(correr('production', { P_CONSTRUCTOR_SITIO_MODO: 'google' }).codigo).not.toBe(0);
  });
  it('staging en modo google sin imagen ni cuenta: falla cerrado', () => {
    const r = correr('staging', { P_CONSTRUCTOR_SITIO_MODO: 'google' });
    expect(r.codigo).not.toBe(0);
    expect(r.salida).toContain('exige CONSTRUCTOR_SITIO_IMAGEN');
  });
  it('staging en modo google completo: rc 0', () => {
    const r = correr('staging', {
      P_CONSTRUCTOR_SITIO_MODO: 'google',
      P_CONSTRUCTOR_SITIO_IMAGEN: `us-east1-docker.pkg.dev/proyecto-x/sitio-constructor/constructor-sitio@sha256:${'a'.repeat(64)}`,
      P_CONSTRUCTOR_SITIO_CUENTA: 'sitio-constructor',
      P_VITE_FIREBASE_API_KEY: 'clave-publica',
      P_VITE_FIREBASE_APP_ID: 'app-x',
      P_VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: 'recaptcha-x',
    });
    expect(r.codigo, r.salida).toBe(0);
    expect(r.valor('CONSTRUCTOR_SITIO_MODO')).toBe('google');
  });
  it('valor con retorno de carro o salto de línea: falla cerrado sin imprimir el valor', () => {
    for (const valor of ['clave\rX=1', 'clave\nX=1']) {
      const r = correr('staging', { P_VITE_FIREBASE_API_KEY: valor });
      expect(r.codigo).not.toBe(0);
      expect(r.salida).toContain('VITE_FIREBASE_API_KEY contiene un salto de línea o un retorno de carro');
      expect(r.salida).not.toContain('X=1');
    }
  });
  it('CONSTRUCTOR_SITIO_CUENTA: nombre, nombre@ o correo del mismo proyecto', () => {
    for (const cuenta of ['sitio-constructor', 'sitio-constructor@', 'sitio-constructor@proyecto-x.iam.gserviceaccount.com']) {
      const r = correr('staging', { P_CONSTRUCTOR_SITIO_CUENTA: cuenta });
      expect(r.codigo, `${cuenta}: ${r.salida}`).toBe(0);
      expect(r.valor('CONSTRUCTOR_SITIO_CUENTA')).toBe(cuenta);
    }
  });
  it('CONSTRUCTOR_SITIO_CUENTA inválida: falla cerrado sin imprimir el valor', () => {
    for (const cuenta of ['Sitio', 'abc', 'sitio-constructor@otro.iam.gserviceaccount.com', 'sitio-constructor@proyecto-x.iam.gserviceaccount.com.evil', 'sitio constructor', 'sitio-constructor-']) {
      const r = correr('staging', { P_CONSTRUCTOR_SITIO_CUENTA: cuenta });
      expect(r.codigo, cuenta).not.toBe(0);
      expect(r.salida).toContain('CONSTRUCTOR_SITIO_CUENTA debe ser');
      expect(r.salida).not.toContain(cuenta);
    }
  });
  it('CUENTA_FN_CONSTRUCTOR_SITIO: nombre@ o correo del mismo proyecto; el nombre solo no (firebase-tools lo rechaza)', () => {
    for (const cuenta of ['fn-constructor-sitio@', 'fn-constructor-sitio@proyecto-x.iam.gserviceaccount.com']) {
      const r = correr('staging', { P_CUENTA_FN_CONSTRUCTOR_SITIO: cuenta });
      expect(r.codigo, `${cuenta}: ${r.salida}`).toBe(0);
      expect(r.valor('CUENTA_FN_CONSTRUCTOR_SITIO')).toBe(cuenta);
    }
    for (const cuenta of ['fn-constructor-sitio', 'fn-constructor-sitio@otro.iam.gserviceaccount.com', 'FN@']) {
      const r = correr('staging', { P_CUENTA_FN_CONSTRUCTOR_SITIO: cuenta });
      expect(r.codigo, cuenta).not.toBe(0);
      expect(r.salida).toContain('CUENTA_FN_CONSTRUCTOR_SITIO debe ser');
    }
  });
  it('APP_ENV distinto del ambiente o id de panel distinto: falla cerrado', () => {
    expect(correr('production', { P_CONSTRUCTOR_SITIO_APP_ENV: 'staging' }).codigo).not.toBe(0);
    expect(correr('staging', { P_SITIO_PANEL_ID: 'otro-panel' }).codigo).not.toBe(0);
  });
});
