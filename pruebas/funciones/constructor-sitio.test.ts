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
    // El permiso de encolar lo da el código (invoker), no el script.
    expect(s).not.toContain('cloudtasks.enqueuer');
    expect(s).not.toContain('tasks queues');
    // O3/O5: cuenta propia de las funciones del constructor con lo suyo; el lanzador no va a la cuenta general.
    expect(s).toContain('gcloud iam service-accounts create fn-constructor-sitio');
    expect(s).toMatch(/--member=serviceAccount:fn-constructor-sitio@<proyecto>\S* --role=projects\/<proyecto>\/roles\/lanzadorConstructorSitio/);
    expect(s).not.toMatch(/--member=serviceAccount:<cuenta-de-las-functions> --role=projects/);
    expect(s).toContain('--role=roles/datastore.user');
    expect(s).not.toContain('O5b.');
    // O6: SITIOS_TENANT solo para fn-constructor-sitio.
    expect(s).toMatch(/secrets add-iam-policy-binding SITIOS_TENANT[^\n]*--member=serviceAccount:fn-constructor-sitio@/);
    expect(s).toMatch(/secrets add-iam-policy-binding SITIO_NEGOCIO_B2[^\n]*--member=serviceAccount:sitio-constructor@/);
    // N9 no corre por defecto.
    expect(s).not.toContain('N9.');
    expect(s).not.toContain('despliegueFuncionesIam');
    expect(s).not.toContain('proyecto-prueba-1');
    expect(s).not.toContain('valor-secreto-xyz');
    expect(s).not.toContain('modo APLICAR');
  });
  it('--neutralizar-cuenta-por-defecto agrega la creación y el cambio de la cuenta por defecto', () => {
    const r = correr(['proyecto-prueba-1', '--neutralizar-cuenta-por-defecto'], { PATH: '/usr/bin:/bin' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('gcloud builds set-default-service-account --service-account=projects/<proyecto>/serviceAccounts/build-funciones@<proyecto>');
    expect(r.stdout).toContain('gcloud iam service-accounts create build-funciones');
    expect(r.stdout).toContain('--role=roles/logging.logWriter');
    expect(r.stdout).toContain('gcloud artifacts repositories add-iam-policy-binding gcf-artifacts');
    expect(r.stdout).toContain('gs://gcf-v2-sources-<numero>-us-east1');
    expect(r.stdout).toContain('--role=roles/storage.objectViewer');
    expect(r.stdout).toContain('volver a desplegar las Functions');
  });
  it('--actas-propio agrega O5b: actAs de cada cuenta sobre sí misma', () => {
    const r = correr(['proyecto-prueba-1', '--actas-propio'], { PATH: '/usr/bin:/bin' });
    expect(r.stdout).toContain('O5b.');
    expect(r.stdout).toContain('add-iam-policy-binding fn-constructor-sitio@<proyecto>.iam.gserviceaccount.com --project=<proyecto> --member=serviceAccount:fn-constructor-sitio@<proyecto>.iam.gserviceaccount.com --role=roles/iam.serviceAccountUser');
  });
  it('--ampliar-despliegue agrega N9 con la lista exacta de permisos', () => {
    const r = correr(['proyecto-prueba-1', '--ampliar-despliegue'], { PATH: '/usr/bin:/bin' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('N9.');
    expect(r.stdout).toContain('gcloud iam roles update despliegueFuncionesIam --project=<proyecto> --add-permissions=cloudtasks.queues.create,cloudtasks.queues.get,cloudtasks.queues.update,cloudtasks.queues.getIamPolicy,cloudtasks.queues.setIamPolicy,pubsub.topics.create,pubsub.topics.get');
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
[[ "$*" == *"projects describe"* ]] && { echo 987654321; exit 0; }
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
          SITIO_RECONSTRUCCION_SECRETO: 'valor-secreto-xyz',
        },
        encoding: 'utf8',
      });
      expect(r.status).toBe(0);
      expect(r.stdout).not.toContain('proyecto-prueba-1');
      expect(r.stdout).not.toContain('valor-secreto-xyz');
      const llamadas = readFileSync(join(dir, 'llamadas.txt'), 'utf8');
      expect(llamadas).not.toContain('valor-secreto-xyz');
      expect(llamadas).not.toContain('tasks queues');
      expect(llamadas).toContain('builds get-default-service-account');
      expect(llamadas).toContain('functions list --v2');
      expect(llamadas).not.toContain('set-default-service-account');
      expect(readFileSync(join(dir, 'stdin.txt'), 'utf8')).toBe('valor-secreto-xyz');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('scripts/preparar-constructor-sitio.sh: O5bis antes de O5', () => {
  const correrConStub = (extraEnv: Record<string, string>, args: string[] = []) => {
    const dir = mkdtempSync(join(tmpdir(), 'prep-o5bis-'));
    try {
      writeFileSync(join(dir, 'gcloud'), `#!/usr/bin/env bash
echo "gcloud $*" >> "${dir}/llamadas.txt"
[[ "$*" == *"versions list"* ]] && exit 0
[[ "$*" == *"projects describe"* ]] && { echo 987654321; exit 0; }
if [[ "$*" == *"get-default-service-account"* && "$*" == *"--format"* ]]; then echo "\${SA_DEFECTO:-}"; exit 0; fi
if [[ "$*" == *"functions list"* && -n "\${FALLA_FUNCTIONS:-}" ]]; then echo "API not enabled" >&2; exit 1; fi
exit 0
`);
      chmodSync(join(dir, 'gcloud'), 0o755);
      const r = spawnSync('bash', [resolve(raiz, 'scripts/preparar-constructor-sitio.sh'), 'proyecto-prueba-1', '--aplicar', ...args], {
        env: {
          PATH: `${dir}:/usr/bin:/bin`,
          CUENTA_FUNCIONES: 'f@proyecto-prueba-1.iam.gserviceaccount.com',
          CUENTA_DESPLIEGUE: 'd@proyecto-prueba-1.iam.gserviceaccount.com',
          ...extraEnv,
        },
        encoding: 'utf8',
      });
      return { r, llamadas: readFileSync(join(dir, 'llamadas.txt'), 'utf8') };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  it('en la simulación O5bis aparece antes que O5', () => {
    const r = spawnSync('bash', [resolve(raiz, 'scripts/preparar-constructor-sitio.sh'), 'proyecto-prueba-1'], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8' });
    expect(r.stdout.indexOf('O5bis.')).toBeGreaterThan(0);
    expect(r.stdout.indexOf('O5bis.')).toBeLessThan(r.stdout.indexOf('O5. Permisos'));
  });
  it.each([
    ['la heredada de Cloud Build', '123456@cloudbuild.gserviceaccount.com'],
    ['la de Compute', '123456-compute@developer.gserviceaccount.com'],
    ['desconocida (falla cerrado)', ''],
  ])('con la cuenta por defecto %s no otorga el rol lanzador y sale con 3', (_n, sa) => {
    const { r, llamadas } = correrConStub({ SA_DEFECTO: sa });
    expect(r.status).toBe(3);
    expect(llamadas).not.toContain('iam roles');
    expect(r.stderr).not.toContain('proyecto-prueba-1');
  });
  it('con una cuenta por defecto acotada sigue y otorga el rol lanzador', () => {
    const { r, llamadas } = correrConStub({ SA_DEFECTO: 'build-funciones@proyecto-prueba-1.iam.gserviceaccount.com' });
    expect(r.status).toBe(0);
    expect(llamadas).toContain('iam roles');
  });
  it('con --neutralizar-cuenta-por-defecto la fija antes de consultar y sigue', () => {
    const { r, llamadas } = correrConStub({ SA_DEFECTO: 'build-funciones@proyecto-prueba-1.iam.gserviceaccount.com' }, ['--neutralizar-cuenta-por-defecto']);
    expect(r.status).toBe(0);
    expect(llamadas.indexOf('set-default-service-account')).toBeGreaterThan(0);
    expect(llamadas.indexOf('set-default-service-account')).toBeLessThan(llamadas.indexOf('iam roles'));
  });
  it('si `functions list --v2` falla (API inactiva) avisa y el script sigue', () => {
    const { r, llamadas } = correrConStub({ SA_DEFECTO: 'a@proyecto-prueba-1.iam.gserviceaccount.com', FALLA_FUNCTIONS: '1' });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('no se pudo consultar las Functions');
    expect(llamadas).toContain('secrets');
  });
});

describe('scripts/preparar-constructor-sitio.sh: fallo cerrado y propagación', () => {
  const correrStub = (cuerpo: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'prep-prop-'));
    try {
      writeFileSync(join(dir, 'gcloud'), `#!/usr/bin/env bash\necho "gcloud $*" >> "${dir}/llamadas.txt"\n${cuerpo.replaceAll('$DIR', dir)}\nexit 0\n`);
      chmodSync(join(dir, 'gcloud'), 0o755);
      const r = spawnSync('bash', [resolve(raiz, 'scripts/preparar-constructor-sitio.sh'), 'proyecto-prueba-1', '--aplicar'], {
        env: {
          PATH: `${dir}:/usr/bin:/bin`,
          ESPERA_PROPAGACION: '0',
          CUENTA_FUNCIONES: 'f@proyecto-prueba-1.iam.gserviceaccount.com',
          CUENTA_DESPLIEGUE: 'd@proyecto-prueba-1.iam.gserviceaccount.com',
          SITIOS_TENANT: 'valor-secreto-xyz',
        },
        encoding: 'utf8',
      });
      return { r, llamadas: readFileSync(join(dir, 'llamadas.txt'), 'utf8') };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const defecto = `if [[ "$*" == *"get-default-service-account"* && "$*" == *"--format"* ]]; then echo "build-funciones@x.iam.gserviceaccount.com"; exit 0; fi`;
  it('si `secrets versions list` falla, no agrega la versión y sale con 3', () => {
    const { r, llamadas } = correrStub(`${defecto}\n[[ "$*" == *"versions list"* ]] && exit 1`);
    expect(r.status).toBe(3);
    expect(llamadas).not.toContain('versions add');
  });
  it('reintenta un enlace de IAM mientras la cuenta no se propaga', () => {
    const { r, llamadas } = correrStub(`${defecto}
[[ "$*" == *"versions list"* ]] && exit 0
if [[ "$*" == *"add-iam-policy-binding"* && ! -e "$DIR/ya" ]]; then touch "$DIR/ya"; echo "no existe" >&2; exit 1; fi`);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('reintento 2');
    expect(llamadas.split('\n').filter((l) => l.includes('add-iam-policy-binding')).length).toBeGreaterThan(1);
  });
});
