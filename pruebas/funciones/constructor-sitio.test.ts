// Imagen y preparación del constructor del sitio: coherencia con el workflow y simulación sin nube.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const raiz = resolve(__dirname, '../..');
const leer = (r: string) => readFileSync(resolve(raiz, r), 'utf8');
const dockerfile = leer('scripts/constructor-sitio/Dockerfile');

describe('scripts/constructor-sitio/Dockerfile', () => {
  it('base node fijada por digest, multi-stage, usuario no root y lockfile congelado', () => {
    expect(dockerfile).toMatch(/^ARG NODE_IMAGEN=node:[\w.-]+@sha256:[0-9a-f]{64}$/m);
    expect(dockerfile).toMatch(/^FROM \$\{NODE_IMAGEN\} AS dependencias$/m);
    expect(dockerfile).toMatch(/^FROM \$\{NODE_IMAGEN\} AS constructor$/m);
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).toContain('pnpm install --frozen-lockfile');
    expect(dockerfile).toContain('reconstruir-sitio.sh');
  });
  it('firebase-tools y pnpm coinciden con el workflow, el script y package.json', () => {
    const wf = /FIREBASE_TOOLS_VERSION: '([\d.]+)'/.exec(leer('.github/workflows/reconstruir-sitio.yml'))?.[1];
    const df = /^ARG FIREBASE_TOOLS_VERSION=([\d.]+)$/m.exec(dockerfile)?.[1];
    const sh = /FIREBASE_TOOLS_VERSION:-([\d.]+)\}/.exec(leer('scripts/reconstruir-sitio.sh'))?.[1];
    expect(df).toBeDefined();
    expect(df).toBe(wf);
    expect(df).toBe(sh);
    const pnpm = /"packageManager": "pnpm@([\d.]+)"/.exec(leer('package.json'))?.[1];
    expect(/^ARG PNPM_VERSION=([\d.]+)$/m.exec(dockerfile)?.[1]).toBe(pnpm);
  });
  it('no lleva secretos ni identificadores', () => {
    expect(dockerfile).not.toMatch(/(secret|token|password)\s*=/i);
    expect(leer('scripts/constructor-sitio/Dockerfile.dockerignore')).toContain('.env');
  });
});

describe('scripts/preparar-constructor-sitio.sh', () => {
  const correr = (args: string[], env: Record<string, string> = {}) =>
    spawnSync('bash', [resolve(raiz, 'scripts/preparar-constructor-sitio.sh'), ...args], {
      // Sin gcloud en el PATH: la simulación no puede llamarlo.
      env: { PATH: '/nonexistent', ...env },
      encoding: 'utf8',
    });

  it('simula por defecto: muestra O1 a O6 sin llamar a gcloud ni imprimir el proyecto ni los valores', () => {
    const r = correr(['proyecto-prueba-1', '--claves', 'a1,b2'], { SITIO_RECONSTRUCCION_SECRETO: 'valor-secreto-xyz', CUENTA_FUNCIONES: 'f@proyecto-prueba-1.iam.gserviceaccount.com', PATH: '/usr/bin:/bin' });
    expect(r.status).toBe(0);
    const s = r.stdout;
    for (const o of ['O1.', 'O2.', 'O3.', 'O4.', 'O5.', 'O6.']) expect(s).toContain(o);
    expect(s).toContain('SIMULACIÓN');
    expect(s).toContain('cloudbuild.builds.create,cloudbuild.builds.get');
    expect(s).toContain('--role=roles/iam.serviceAccountUser');
    expect(s).toContain('sitio-constructor@<proyecto>.iam.gserviceaccount.com');
    expect(s).toContain('SITIO_NEGOCIO_B2');
    expect(s).toContain('--locations=us-east1');
    expect(s).not.toContain('proyecto-prueba-1');
    expect(s).not.toContain('valor-secreto-xyz');
    expect(s).not.toContain('modo APLICAR');
  });
  it('--aplicar exige la cuenta de las Functions', () => {
    expect(correr(['proyecto-prueba-1', '--aplicar'], { PATH: '/usr/bin:/bin' }).status).toBe(2);
  });
  it.each([[[]], [['MAL_ID']], [['proyecto-prueba-1', '--otra']], [['proyecto-prueba-1', '--claves', 'MAL']]])('uso inválido %j da 2', (args) => {
    expect(correr(args, { PATH: '/usr/bin:/bin' }).status).toBe(2);
  });
});
