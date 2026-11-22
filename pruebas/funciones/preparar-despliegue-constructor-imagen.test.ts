// .github/scripts/preparar-despliegue-firebase.sh y CONSTRUCTOR_SITIO_IMAGEN (plan Cloud Build): por digest, del Artifact
// Registry del mismo proyecto y solo en staging. Corre el script real en un árbol mínimo: `firebase`,
// `scripts/sitios-tenant.mjs` y `empaquetar.mjs` son sustitutos (no tocan la nube ni compilan).
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve('.github/scripts/preparar-despliegue-firebase.sh');
const BASE = 'https://medios.ejemplo.test';
const CSP_PANEL = `default-src 'self'; img-src 'self' ${BASE}/`;
const FIREBASE_JSON = {
  hosting: [
    { target: 'sitio', public: 'dist/website', headers: [{ source: '**', headers: [{ key: 'Content-Security-Policy', value: "default-src 'self'" }] }] },
    { target: 'panel', public: 'dist/panel', headers: [{ source: '**', headers: [{ key: 'Content-Security-Policy', value: CSP_PANEL }] }] },
  ],
};
// Sustituto de empaquetar.mjs: copia FUNCIONES_PARAMETROS a dist/funciones/.env como el real y, si se pide, deja además
// un .env.<proyecto> con el contenido de EXTRA_ENV (simula un .env previo que sobrevive al empaquetado).
const EMPAQUETAR = `import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('dist/funciones', { recursive: true });
copyFileSync(process.env.FUNCIONES_PARAMETROS, 'dist/funciones/.env');
if (process.env.EXTRA_ENV) writeFileSync('dist/funciones/.env.proyecto-x', process.env.EXTRA_ENV);
`;

const temporales: string[] = [];
afterEach(() => { for (const t of temporales.splice(0)) rmSync(t, { recursive: true, force: true }); });

function arbol(): string {
  const dir = mkdtempSync(join(tmpdir(), 'preparar-despliegue-'));
  temporales.push(dir);
  mkdirSync(join(dir, 'dist'), { recursive: true });
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, 'plataforma/funciones/scripts'), { recursive: true });
  mkdirSync(join(dir, 'bin'));
  mkdirSync(join(dir, 'runner'));
  writeFileSync(join(dir, 'firebase.json'), JSON.stringify(FIREBASE_JSON));
  cpSync(join(dir, 'firebase.json'), join(dir, 'dist/firebase.json'));
  writeFileSync(join(dir, 'scripts/sitios-tenant.mjs'), 'process.exit(0);\n');
  writeFileSync(join(dir, 'plataforma/funciones/scripts/empaquetar.mjs'), EMPAQUETAR);
  writeFileSync(join(dir, 'bin/firebase'), '#!/usr/bin/env bash\nexit 0\n');
  chmodSync(join(dir, 'bin/firebase'), 0o755);
  return dir;
}

function correr(ambiente: 'staging' | 'production', extra: Record<string, string> = {}) {
  const dir = arbol();
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
  const leer = (ruta: string) => { try { return readFileSync(join(dir, ruta), 'utf8'); } catch { return ''; } };
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}`, envFunciones: leer('dist/funciones/.env') };
}

const DIGEST = 'a'.repeat(64);
const imagen = (proyecto: string, ref: string) => `us-east1-docker.pkg.dev/${proyecto}/sitio-constructor/constructor-sitio${ref}`;
const lineaImagen = (env: string) => env.split('\n').filter((l) => l.startsWith('CONSTRUCTOR_SITIO_IMAGEN'));

describe('preparar-despliegue-firebase.sh: CONSTRUCTOR_SITIO_IMAGEN', () => {
  it('staging sin imagen: rc 0 y la línea queda vacía', () => {
    const r = correr('staging');
    expect(r.codigo).toBe(0);
    expect(lineaImagen(r.envFunciones)).toEqual(['CONSTRUCTOR_SITIO_IMAGEN=']);
  });
  it('staging con digest válido del mismo proyecto: rc 0 y el valor llega a dist/funciones/.env', () => {
    const valor = imagen('proyecto-x', `@sha256:${DIGEST}`);
    const r = correr('staging', { P_CONSTRUCTOR_SITIO_IMAGEN: valor });
    expect(r.codigo).toBe(0);
    expect(lineaImagen(r.envFunciones)).toEqual([`CONSTRUCTOR_SITIO_IMAGEN=${valor}`]);
  });
  it('staging con tag :latest: rc 1, sin eco del valor', () => {
    const valor = imagen('proyecto-x', ':latest');
    const r = correr('staging', { P_CONSTRUCTOR_SITIO_IMAGEN: valor });
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('por digest, nunca por tag');
    expect(r.salida).not.toContain(valor);
  });
  it('staging con la imagen de otro proyecto: rc 1', () => {
    const r = correr('staging', { P_CONSTRUCTOR_SITIO_IMAGEN: imagen('otro-proyecto', `@sha256:${DIGEST}`) });
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('CONSTRUCTOR_SITIO_IMAGEN debe ser');
  });
  it('production con imagen: rc 1', () => {
    const r = correr('production', { P_CONSTRUCTOR_SITIO_IMAGEN: imagen('proyecto-x', `@sha256:${DIGEST}`) });
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('solo se admite en staging');
  });
  it('production sin imagen: rc 0', () => {
    const r = correr('production');
    expect(r.codigo).toBe(0);
    expect(lineaImagen(r.envFunciones)).toEqual(['CONSTRUCTOR_SITIO_IMAGEN=']);
  });
});
