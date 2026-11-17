// .github/scripts/preparar-despliegue-firebase.sh y el plan `pruebas` (B-D, barrera 3): PLAN_PRUEBAS_HABILITADO=si solo en
// staging, vacío en production, nunca por variable, y ningún .env* empaquetado lo pisa. Corre el script real en un árbol
// mínimo: `firebase`, `scripts/sitios-tenant.mjs` y `empaquetar.mjs` son sustitutos (no tocan la nube ni compilan).
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

const lineasPlan = (env: string) => env.split('\n').filter((l) => l.startsWith('PLAN_PRUEBAS_HABILITADO'));

describe('preparar-despliegue-firebase.sh: PLAN_PRUEBAS_HABILITADO', () => {
  it('staging: escribe PLAN_PRUEBAS_HABILITADO=si en el .env de Functions', () => {
    const r = correr('staging');
    expect(r.salida).not.toContain('::error::');
    expect(r.codigo).toBe(0);
    expect(lineasPlan(r.envFunciones)).toEqual(['PLAN_PRUEBAS_HABILITADO=si']);
  });

  it('production: nunca escribe si; deja la línea vacía (valor por defecto, plan deshabilitado)', () => {
    const r = correr('production');
    expect(r.codigo).toBe(0);
    expect(lineasPlan(r.envFunciones)).toEqual(['PLAN_PRUEBAS_HABILITADO=']);
    expect(r.envFunciones).not.toMatch(/PLAN_PRUEBAS_HABILITADO=\S/);
  });

  it('una variable P_PLAN_PRUEBAS_HABILITADO o PLAN_PRUEBAS_HABILITADO falla cerrado, sin eco del valor', () => {
    for (const ambiente of ['production', 'staging'] as const) {
      for (const nombre of ['P_PLAN_PRUEBAS_HABILITADO', 'PLAN_PRUEBAS_HABILITADO']) {
        for (const valor of ['si', 'valor-privado', '']) {
          const r = correr(ambiente, { [nombre]: valor });
          expect(r.codigo).toBe(1);
          expect(r.salida).toContain('PLAN_PRUEBAS_HABILITADO no se admite como variable');
          expect(r.salida).not.toContain('valor-privado');
          expect(r.envFunciones).toBe('');
        }
      }
    }
  });

  it('un .env previo que nombra PLAN_PRUEBAS_HABILITADO falla cerrado en ambos ambientes', () => {
    for (const ambiente of ['production', 'staging'] as const) {
      for (const extra of ['PLAN_PRUEBAS_HABILITADO=si\n', 'export PLAN_PRUEBAS_HABILITADO = "si"\n', 'PLAN_PRUEBAS_HABILITADO=\n']) {
        const r = correr(ambiente, { EXTRA_ENV: extra });
        expect(r.codigo).toBe(1);
        expect(r.salida).toContain('define PLAN_PRUEBAS_HABILITADO');
      }
    }
  });

  it('un .env previo sin el parámetro no afecta', () => {
    const r = correr('production', { EXTRA_ENV: 'OTRO=1\n' });
    expect(r.codigo).toBe(0);
  });
});
