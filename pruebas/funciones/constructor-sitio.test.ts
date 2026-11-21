// Imagen y preparación del constructor del sitio: coherencia con el workflow y simulación sin nube.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const raiz = resolve(__dirname, '../..');
const leer = (r: string) => readFileSync(resolve(raiz, r), 'utf8');
const dockerfile = leer('scripts/constructor-sitio/Dockerfile');

describe('scripts/constructor-sitio/Dockerfile', () => {
  it('base node fijada por digest, multi-stage, usuario no root y lockfile congelado', () => {
    // Digest literal en cada FROM (Checkov CKV_DOCKER_7 no acepta ARG).
    expect(dockerfile).toMatch(/^FROM node:[\w.-]+@sha256:[0-9a-f]{64} AS dependencias$/m);
    expect(dockerfile).toMatch(/^FROM node:[\w.-]+@sha256:[0-9a-f]{64} AS constructor$/m);
    expect(dockerfile).toMatch(/^HEALTHCHECK /m);
    // La imagen final no conserva npm ni corepack (su árbol de dependencias lo marca Trivy).
    expect(dockerfile).toContain('rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack');
    expect(dockerfile).not.toMatch(/^\s*(ENV\s+)?NODE_ENV=/m);
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).toContain('pnpm install --frozen-lockfile');
    expect(dockerfile).toContain('reconstruir-sitio.sh');
  });
  it('firebase-tools y pnpm coinciden con los workflows, el script, deploy.sh y package.json', () => {
    const dep = /FIREBASE_TOOLS_VERSION:-([\d.]+)\}/.exec(leer('deploy.sh'))?.[1];
    // Los dos workflows que instalan firebase-tools (CI y reconstrucción del sitio por GitHub).
    const wfCi = /FIREBASE_TOOLS_VERSION: '([\d.]+)'/.exec(leer('.github/workflows/ci-node-firebase.yml'))?.[1];
    const wfSitio = /FIREBASE_TOOLS_VERSION: '([\d.]+)'/.exec(leer('.github/workflows/reconstruir-sitio.yml'))?.[1];
    const df = /^ARG FIREBASE_TOOLS_VERSION=([\d.]+)$/m.exec(dockerfile)?.[1];
    const sh = /FIREBASE_TOOLS_VERSION:-([\d.]+)\}/.exec(leer('scripts/reconstruir-sitio.sh'))?.[1];
    expect(df).toBeDefined();
    expect(df).toBe(dep);
    expect(df).toBe(sh);
    expect(wfCi).toBe(df);
    expect(wfSitio).toBe(df);
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
    expect(s).toContain('--member=serviceAccount:<cuenta-de-despliegue> --role=roles/artifactregistry.writer');
    expect(s).toContain('O5bis.');
    expect(s).toContain('gcloud builds get-default-service-account');
    expect(s).toContain('gcloud functions list --v2');
    // El cambio de la cuenta por defecto de Cloud Build solo con la opción explícita.
    expect(s).not.toContain('set-default-service-account');
    // cloudtasks.enqueuer sobre la cola, no sobre el proyecto.
    expect(s).toContain('gcloud tasks queues add-iam-policy-binding <cola>');
    expect(s).not.toMatch(/projects add-iam-policy-binding[^\n]*cloudtasks\.enqueuer/);
    expect(s).not.toContain('proyecto-prueba-1');
    expect(s).not.toContain('valor-secreto-xyz');
    expect(s).not.toContain('modo APLICAR');
  });
  it('--neutralizar-cuenta-por-defecto agrega la creación y el cambio de la cuenta por defecto', () => {
    const r = correr(['proyecto-prueba-1', '--neutralizar-cuenta-por-defecto'], { PATH: '/usr/bin:/bin' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('gcloud builds set-default-service-account --service-account=projects/<proyecto>/serviceAccounts/build-sin-permisos@<proyecto>');
    expect(r.stdout).toContain('gcloud iam service-accounts create build-sin-permisos');
  });
  it('--aplicar exige la cuenta de las Functions', () => {
    expect(correr(['proyecto-prueba-1', '--aplicar'], { PATH: '/usr/bin:/bin' }).status).toBe(2);
  });
  it.each([[[]], [['MAL_ID']], [['proyecto-prueba-1', '--otra']], [['proyecto-prueba-1', '--claves', 'MAL']]])('uso inválido %j da 2', (args) => {
    expect(correr(args, { PATH: '/usr/bin:/bin' }).status).toBe(2);
  });
});

describe('scripts/preparar-constructor-sitio.sh --aplicar (gcloud sustituto)', () => {
  it('ejecuta los pasos, pasa el secreto por stdin y no imprime el id del proyecto aunque gcloud lo haga', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prep-constructor-'));
    try {
      writeFileSync(join(dir, 'gcloud'), `#!/usr/bin/env bash
echo "gcloud $*" >> "${dir}/llamadas.txt"
[[ "$*" == *"versions list"* ]] && exit 0
echo "salida de gcloud para proyecto-prueba-1 y f@proyecto-prueba-1.iam.gserviceaccount.com"
if [[ "$1 $2" == "secrets versions" && "$3" == add ]]; then cat > "${dir}/stdin.txt"; fi
exit 0
`);
      chmodSync(join(dir, 'gcloud'), 0o755);
      const r = spawnSync('bash', [resolve(raiz, 'scripts/preparar-constructor-sitio.sh'), 'proyecto-prueba-1', '--aplicar'], {
        env: {
          PATH: `${dir}:/usr/bin:/bin`,
          CUENTA_FUNCIONES: 'f@proyecto-prueba-1.iam.gserviceaccount.com',
          CUENTA_DESPLIEGUE: 'd@proyecto-prueba-1.iam.gserviceaccount.com',
          COLA_TAREAS: 'cola-prueba',
          SITIO_RECONSTRUCCION_SECRETO: 'valor-secreto-xyz',
        },
        encoding: 'utf8',
      });
      expect(r.status).toBe(0);
      expect(r.stdout).not.toContain('proyecto-prueba-1');
      expect(r.stdout).not.toContain('valor-secreto-xyz');
      const llamadas = readFileSync(join(dir, 'llamadas.txt'), 'utf8');
      expect(llamadas).not.toContain('valor-secreto-xyz');
      expect(llamadas).toContain('tasks queues add-iam-policy-binding cola-prueba');
      expect(llamadas).toContain('builds get-default-service-account');
      expect(llamadas).toContain('functions list --v2');
      expect(llamadas).not.toContain('set-default-service-account');
      expect(readFileSync(join(dir, 'stdin.txt'), 'utf8')).toBe('valor-secreto-xyz');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('--aplicar exige COLA_TAREAS', () => {
    const r = spawnSync('bash', [resolve(raiz, 'scripts/preparar-constructor-sitio.sh'), 'proyecto-prueba-1', '--aplicar'], {
      env: {
        PATH: '/usr/bin:/bin',
        CUENTA_FUNCIONES: 'f@proyecto-prueba-1.iam.gserviceaccount.com',
        CUENTA_DESPLIEGUE: 'd@proyecto-prueba-1.iam.gserviceaccount.com',
      },
      encoding: 'utf8',
    });
    expect(r.status).toBe(2);
  });
});
