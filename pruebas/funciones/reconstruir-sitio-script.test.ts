// scripts/reconstruir-sitio.sh: los pasos 2 a 9 del job `reconstruir` fuera de GitHub. Se prueba con un PATH de
// sustitutos (node, pnpm, firebase, curl, npm, sleep) que registran cada llamada: no toca la red.
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, '../../scripts/reconstruir-sitio.sh');
const TENANT = 'tienda-prueba';
const SITIO = 'sitio-prueba-1';
const URL_SITIO = 'https://sitio-prueba-1.example.com';
const PROYECTO = 'proyecto-prueba';

// Sustituto único: se comporta según variables de entorno y deja una línea por llamada en $LOG.
const COMUN = `#!/usr/bin/env bash
n="$1"; shift
echo "$n $*" >> "$LOG"
echo "ENV $n $1 CONTENIDO=\${SITIO_CONTENIDO:-} SECRETO=\${SITIO_RECONSTRUCCION_SECRETO:+si} NEGOCIO=\${SITIO_NEGOCIO:+si} CRED=\${GOOGLE_APPLICATION_CREDENTIALS:+si} EXIGIR=\${EXIGIR_DIST:-}" >> "$LOG"
case "$n" in
  node)
    case "$1" in
      scripts/contenido-sitio.mjs)
        sub="$2"
        case "$sub" in
          pendiente) echo "\${ID_PENDIENTE:-}" ;;
          estado)
            v="RC_ESTADO_$4"
            if [[ "$4" == en_curso && -n "\${REPETIDO:-}" ]]; then echo "estado repetido"; else echo "estado cambiado"; fi
            exit "\${!v:-0}" ;;
          generar)
            while (( $# > 0 )); do [[ "$1" == --salida ]] && echo '{}' > "$2"; shift; done
            [[ "\${FALLA:-}" == generar ]] && exit 1
            exit 0 ;;
          *) v="RC_SUB_$sub"; exit "\${!v:-0}" ;;
        esac ;;
      scripts/build.mjs) [[ "\${DORMIR:-}" == build ]] && { echo "dormido" >> "$LOG"; /bin/sleep 30; }; [[ "\${FALLA:-}" == build ]] && exit 1; echo "build de ${SITIO} en ${PROYECTO}"; exit 0 ;;
      scripts/certificar-sitio.mjs)
        c="$LOG.cert"; k=$(( $(cat "$c" 2>/dev/null || echo 0) + 1 )); echo "$k" > "$c"
        IFS=, read -r -a rcs <<<"\${CERT_RCS:-0}"
        exit "\${rcs[$((k - 1))]:-\${rcs[-1]}}" ;;
    esac ;;
  pnpm)
    [[ "\${FALLA:-}" == pruebas && "$1" == vitest ]] && exit 1
    [[ "\${FALLA:-}" == instalar && "$1" == install ]] && exit 1
    exit 0 ;;
  firebase)
    case "$1" in
      --version) echo 15.37.0 ;;
      deploy)
        echo "Hosting URL: ${URL_SITIO} tenant ${TENANT} sitio ${SITIO}"
        [[ "\${FALLA:-}" == registro ]] && echo "Deploy failed"
        [[ "\${FALLA:-}" == nositio ]] && { echo "Error: site not found"; exit 1; }
        exit "\${RC_DEPLOY:-0}" ;;
      hosting:clone) echo "clon de ${SITIO}"; exit "\${RC_CLON:-0}" ;;
      *) exit 0 ;;
    esac ;;
  curl)
    while (( $# > 0 )); do [[ "$1" == -D ]] && echo "content-security-policy: x" > "$2"; shift; done
    echo -n "\${CURL_CODIGO:-200}" ;;
esac
exit 0
`;

let raiz = '';
let bin = '';
let n = 0;

beforeAll(() => {
  raiz = mkdtempSync(join(tmpdir(), 'rec-sitio-'));
  bin = join(raiz, 'bin');
  mkdirSync(bin);
  mkdirSync(join(raiz, 'repo/.github/scripts'), { recursive: true });
  writeFileSync(join(raiz, 'repo/.github/scripts/preparar-sitio-tenant.sh'), '#!/usr/bin/env bash\necho "preparar $1" >> "$LOG"\n');
  writeFileSync(join(raiz, 'comun.sh'), COMUN);
  for (const nombre of ['node', 'pnpm', 'firebase', 'curl', 'npm', 'sleep']) {
    writeFileSync(join(bin, nombre), `#!/usr/bin/env bash\nexec bash "${join(raiz, 'comun.sh')}" ${nombre} "$@"\n`);
    chmodSync(join(bin, nombre), 0o755);
  }
});
afterAll(() => rmSync(raiz, { recursive: true, force: true }));

const BASE: Record<string, string> = {
  CLAVE: 'a1',
  TENANT,
  SITIO,
  URL_SITIO,
  PROYECTO,
  SITIOS_PROHIBIDOS: 'sitio-panel-x',
  SITIO_RECONSTRUCCION_SECRETO: 'secreto-de-prueba',
  SITIO_NEGOCIO: '{"a":1}',
  VITE_FIREBASE_PROJECT_ID: 'proyecto-prueba',
  VITE_FIREBASE_API_KEY: 'k',
  VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: 'k',
  VITE_FIREBASE_APP_ID: 'k',
  MEDIOS_BASE_URL: 'https://medios.example.com',
  OMITIR_INSTALAR: '',
};

function correr(args: string[], extra: Record<string, string> = {}) {
  n += 1;
  const log = join(raiz, `log-${String(n)}.txt`);
  writeFileSync(log, '');
  const env = {
    PATH: `${bin}:/usr/bin:/bin`,
    HOME: raiz,
    RAIZ_REPO: join(raiz, 'repo'),
    RUNNER_TEMP: mkdtempSync(join(raiz, 't-')),
    LOG: log,
    ...BASE,
    ...extra,
  };
  const r = spawnSync('bash', [SCRIPT, ...args], { env, encoding: 'utf8' });
  const llamadas = readFileSync(log, 'utf8').split('\n').filter(Boolean);
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}`, llamadas, temp: env.RUNNER_TEMP, cert: existsSync(`${log}.cert`) ? Number(readFileSync(`${log}.cert`, 'utf8')) : 0 };
}
const estados = (ll: string[]) => ll.filter((l) => l.startsWith('node scripts/contenido-sitio.mjs estado')).map((l) => l.split(' ').slice(3, 5).join(' '));
const sinIdentificadores = (s: string) => {
  for (const v of [TENANT, SITIO, URL_SITIO, PROYECTO, 'secreto-de-prueba']) expect(s).not.toContain(v);
};

describe('reconstruir-sitio.sh: simulación y entradas', () => {
  it('SIMULAR=1 lista los pasos sin llamar a ninguna herramienta ni imprimir identificadores', () => {
    const r = correr([], { SIMULAR: '1', TRABAJO: 'rec-1' });
    expect(r.codigo).toBe(0);
    expect(r.llamadas).toEqual([]);
    expect(r.salida).toContain('SIMULAR paso 1: tomar el trabajo');
    expect(r.salida).toContain('SIMULAR paso 14: cerrar trabajos rezagados');
    sinIdentificadores(r.salida);
  });
  it('SIMULAR=1 en modo certificar lista solo la certificación', () => {
    const r = correr(['certificar'], { SIMULAR: '1' });
    expect(r.codigo).toBe(0);
    expect(r.llamadas).toEqual([]);
    expect(r.salida).toContain('certificar a pedido');
    expect(r.salida).not.toContain('desplegar');
  });
  it.each([
    ['clave inválida', { CLAVE: 'A-1' }],
    ['tenant corto', { TENANT: 'ab' }],
    ['sitio inválido', { SITIO: 'MAL SITIO' }],
    ['url con ruta', { URL_SITIO: 'https://sitio-prueba-1.example.com/ruta' }],
    ['sin sitios prohibidos', { SITIOS_PROHIBIDOS: '' }],
    ['sin trabajo ni modo de sondeo', { TRABAJO: '', MODO_SONDEO: '' }],
  ])('falla cerrado (%s) sin tocar nada ni imprimir valores', (_n, extra) => {
    const r = correr([], { SIMULAR: '1', MODO_SONDEO: '', ...extra });
    expect(r.codigo).toBe(1);
    expect(r.llamadas).toEqual([]);
    expect(r.salida).not.toContain('SIMULAR paso');
    expect(r.salida).not.toContain(TENANT);
  });
  it('un modo desconocido es uso inválido (2)', () => {
    expect(correr(['otro']).codigo).toBe(2);
  });
});

describe('reconstruir-sitio.sh: flujo con sustitutos', () => {
  it('camino feliz con TRABAJO: mismos pasos y orden que el workflow, y nada de identificadores en el log', () => {
    const r = correr([], { TRABAJO: 'rec-publicacion-v3-202611211200' });
    expect(r.codigo).toBe(0);
    const ll = r.llamadas.join('\n');
    const orden = [
      'estado rec-publicacion-v3-202611211200 en_curso',
      'node scripts/contenido-sitio.mjs generar',
      'node scripts/build.mjs --mode staging --solo sitio --sitio',
      'pnpm vitest run pruebas/website/dist-real.test.ts',
      'preparar ',
      'firebase hosting:channel:create previa',
      'firebase hosting:clone',
      'firebase deploy --only hosting',
      'curl',
      'node scripts/certificar-sitio.mjs',
      'estado rec-publicacion-v3-202611211200 completada',
      'node scripts/contenido-sitio.mjs cubiertos',
      'node scripts/contenido-sitio.mjs rezagados',
    ];
    let desde = 0;
    for (const paso of orden) {
      const i = ll.indexOf(paso, desde);
      expect(i, paso).toBeGreaterThanOrEqual(0);
      desde = i;
    }
    expect(r.llamadas.filter((l) => l.startsWith('curl'))).toHaveLength(3);
    expect(r.llamadas.some((l) => l.startsWith('pnpm install --frozen-lockfile'))).toBe(true);
    expect(r.llamadas.find((l) => l.startsWith('node scripts/certificar-sitio.mjs'))).toContain('--contenido');
    expect(estados(r.llamadas)).toEqual(['rec-publicacion-v3-202611211200 en_curso', 'rec-publicacion-v3-202611211200 completada']);
    // El despliegue imprimió identificadores: el filtro los oculta.
    expect(r.salida).toContain('Hosting URL: ***');
    for (const v of [TENANT, SITIO, 'secreto-de-prueba']) expect(r.salida).not.toContain(v);
  });
  it('OMITIR_INSTALAR=1 no instala dependencias', () => {
    const r = correr([], { TRABAJO: 'rec-1', OMITIR_INSTALAR: '1' });
    expect(r.codigo).toBe(0);
    expect(r.llamadas.some((l) => l.startsWith('pnpm install'))).toBe(false);
  });
  it('un 409 al tomar el trabajo termina con 10 (no desplegó, no es un fallo) sin tocar nada más', () => {
    const r = correr([], { TRABAJO: 'rec-1', RC_ESTADO_en_curso: '3' });
    expect(r.codigo).toBe(10);
    expect(r.llamadas.some((l) => l.includes('build.mjs') || l.startsWith('firebase'))).toBe(false);
    expect(estados(r.llamadas)).toEqual(['rec-1 en_curso']);
  });
  it('la respuesta «repetido» al tomar el trabajo significa que otro ya lo tomó: 10 y sin desplegar ni cerrar', () => {
    const r = correr([], { TRABAJO: 'rec-1', REPETIDO: '1' });
    expect(r.codigo).toBe(10);
    expect(r.llamadas.some((l) => l.includes('build.mjs') || l.startsWith('firebase'))).toBe(false);
    expect(estados(r.llamadas)).toEqual(['rec-1 en_curso']);
  });
  it('otro código al tomar el trabajo falla', () => {
    expect(correr([], { TRABAJO: 'rec-1', RC_ESTADO_en_curso: '1' }).codigo).toBe(1);
  });
  it('sin TRABAJO: toma el pendiente de la cola; sin ninguno y en modo pendientes termina sin hacer nada', () => {
    const con = correr([], { MODO_SONDEO: 'pendientes', ID_PENDIENTE: 'rec-9' });
    expect(con.codigo).toBe(0);
    expect(estados(con.llamadas)).toEqual(['rec-9 en_curso', 'rec-9 completada']);
    const sin = correr([], { MODO_SONDEO: 'pendientes', ID_PENDIENTE: '' });
    expect(sin.codigo).toBe(10);
    expect(sin.llamadas.some((l) => l.includes('build.mjs'))).toBe(false);
  });
  it('sin TRABAJO ni cola en modo todos: reconstruye igual, sin cerrar nada, y limpia cubiertos y rezagados', () => {
    const r = correr([], { MODO_SONDEO: 'todos', ID_PENDIENTE: '' });
    expect(r.codigo).toBe(0);
    expect(estados(r.llamadas)).toEqual([]);
    expect(r.llamadas.some((l) => l.includes('build.mjs'))).toBe(true);
    expect(r.llamadas.some((l) => l.includes(' rezagados'))).toBe(true);
  });

  it.each([
    ['generar', 'generar'],
    ['build', 'build'],
    ['pruebas', 'pruebas'],
    ['registro', 'despliegue'],
  ])('una falla en «%s» cierra el trabajo fallida con la etapa «%s» y no lo completa', (falla, etapa) => {
    const r = correr([], { TRABAJO: 'rec-1', FALLA: falla });
    expect(r.codigo).not.toBe(0);
    expect(estados(r.llamadas)).toEqual(['rec-1 en_curso', 'rec-1 fallida']);
    expect(r.llamadas.find((l) => l.includes(' fallida '))).toContain(`--etapa ${etapa}`);
    expect(r.llamadas.some((l) => l.includes(' rezagados'))).toBe(false);
    sinIdentificadores(r.salida.replaceAll('Hosting URL: ***', ''));
  });
  it('una falla al preparar el clon previo solo avisa y sigue', () => {
    const r = correr([], { TRABAJO: 'rec-1', RC_CLON: '1' });
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('no se pudo guardar la copia para rollback');
  });

  it('certificación: un reintento a los 20 s solo con código 1', () => {
    const r = correr([], { TRABAJO: 'rec-1', CERT_RCS: '1,0' });
    expect(r.codigo).toBe(0);
    expect(r.cert).toBe(2);
    expect(r.llamadas).toContain('sleep 20');
    expect(estados(r.llamadas).at(-1)).toBe('rec-1 completada');
  });
  it.each([
    ['1,1', 2],
    ['3,0', 1],
    ['2,0', 1],
  ])('certificación fallida (códigos %s): %i intento(s), trabajo fallida en «certificacion»', (rcs, intentos) => {
    const r = correr([], { TRABAJO: 'rec-1', CERT_RCS: rcs });
    expect(r.codigo).not.toBe(0);
    expect(r.cert).toBe(intentos);
    expect(r.llamadas.find((l) => l.includes(' fallida '))).toContain('--etapa certificacion');
    expect(r.llamadas.some((l) => l.includes(' completada'))).toBe(false);
  });

  it('si falla el cierre completada, no se marca fallida y la ejecución queda en rojo', () => {
    const r = correr([], { TRABAJO: 'rec-1', RC_ESTADO_completada: '1' });
    expect(r.codigo).not.toBe(0);
    expect(r.llamadas.some((l) => l.includes(' fallida '))).toBe(false);
  });
  it('si falla «cubiertos», los rezagados corren igual y la ejecución queda en rojo sin marcar fallida', () => {
    const r = correr([], { TRABAJO: 'rec-1', RC_SUB_cubiertos: '1' });
    expect(r.codigo).toBe(1);
    expect(r.llamadas.some((l) => l.includes(' rezagados'))).toBe(true);
    expect(r.llamadas.some((l) => l.includes(' fallida '))).toBe(false);
  });
  it('escribe GITHUB_STEP_SUMMARY solo si existe', () => {
    const archivo = join(raiz, 'resumen.md');
    writeFileSync(archivo, '');
    expect(correr([], { TRABAJO: 'rec-1', GITHUB_STEP_SUMMARY: archivo }).codigo).toBe(0);
    expect(readFileSync(archivo, 'utf8')).toContain('Certificación del sitio a1');
    expect(correr([], { TRABAJO: 'rec-1' }).codigo).toBe(0);
  });
});

describe('reconstruir-sitio.sh certificar', () => {
  it('solo certifica: sin tomar trabajo, compilar, desplegar ni cerrar; sin --contenido', () => {
    const r = correr(['certificar']);
    expect(r.codigo).toBe(0);
    expect(estados(r.llamadas)).toEqual([]);
    expect(r.llamadas.some((l) => l.includes('build.mjs') || l.startsWith('firebase') || l.includes('generar'))).toBe(false);
    const c = r.llamadas.find((l) => l.startsWith('node scripts/certificar-sitio.mjs'));
    expect(c).toBeDefined();
    expect(c).not.toContain('--contenido');
  });
  it('sin el secreto o sin el negocio da código 3 (error de operación)', () => {
    expect(correr(['certificar'], { SITIO_RECONSTRUCCION_SECRETO: '' }).codigo).toBe(3);
    expect(correr(['certificar'], { SITIO_NEGOCIO: '' }).codigo).toBe(3);
  });
  it('lee el negocio de SITIO_NEGOCIO_<CLAVE> si SITIO_NEGOCIO no está', () => {
    expect(correr(['certificar'], { SITIO_NEGOCIO: '', SITIO_NEGOCIO_A1: '{}' }).codigo).toBe(0);
  });
  it('un código 1 se reintenta una vez; un 1 persistente devuelve 1', () => {
    expect(correr(['certificar'], { CERT_RCS: '1,0' }).codigo).toBe(0);
    expect(correr(['certificar'], { CERT_RCS: '1,1' }).codigo).toBe(1);
  });
});

describe('reconstruir-sitio.sh: contenido de la compilación, secretos y entradas nuevas', () => {
  const linea = (ll: string[], prefijo: string) => ll.find((l) => l.startsWith(prefijo)) ?? '';
  it('build y dist-real reciben la ruta del contenido GENERADO (no el de ejemplo), con EXIGIR_DIST=1', () => {
    const r = correr([], { TRABAJO: 'rec-1' });
    expect(r.codigo).toBe(0);
    const generar = r.llamadas.find((l) => l.startsWith('node scripts/contenido-sitio.mjs generar')) ?? '';
    const ruta = /--salida (\S+)/.exec(generar)?.[1];
    expect(ruta).toBeDefined();
    expect(linea(r.llamadas, 'ENV node scripts/build.mjs')).toContain(`CONTENIDO=${ruta ?? ''}`);
    const vitest = linea(r.llamadas, 'ENV pnpm vitest');
    expect(vitest).toContain(`CONTENIDO=${ruta ?? ''}`);
    expect(vitest).toContain('EXIGIR=1');
    expect(ruta).toContain(r.temp);
  });
  it('los secretos llegan solo a contenido-sitio.mjs (el negocio solo a «generar»), nunca a pnpm, build, vitest ni firebase', () => {
    const r = correr([], { TRABAJO: 'rec-1' });
    const env = r.llamadas.filter((l) => l.startsWith('ENV '));
    for (const l of env) {
      if (!l.startsWith('ENV node scripts/contenido-sitio.mjs')) expect(l, l).toContain('SECRETO= NEGOCIO=');
    }
    const contenido = env.filter((l) => l.startsWith('ENV node scripts/contenido-sitio.mjs'));
    expect(contenido.length).toBeGreaterThan(3);
    for (const l of contenido) expect(l).toContain('SECRETO=si');
    // El negocio solo en «generar» (una única llamada).
    expect(contenido.filter((l) => l.includes('NEGOCIO=si'))).toHaveLength(1);
    expect(env.find((l) => l.startsWith('ENV node scripts/certificar-sitio.mjs'))).toContain('SECRETO= NEGOCIO=');
  });
  it('la certificación a pedido sí recibe el secreto y el negocio; pnpm install, no', () => {
    const r = correr(['certificar']);
    expect(linea(r.llamadas, 'ENV node scripts/certificar-sitio.mjs')).toContain('SECRETO=si NEGOCIO=si');
    expect(linea(r.llamadas, 'ENV pnpm install')).toContain('SECRETO= NEGOCIO=');
  });
  it('pnpm, build y vitest corren sin las credenciales de nube del entorno', () => {
    const r = correr([], { TRABAJO: 'rec-1', GOOGLE_APPLICATION_CREDENTIALS: '/ruta/cred.json' });
    for (const p of ['ENV pnpm install', 'ENV node scripts/build.mjs', 'ENV pnpm vitest']) expect(linea(r.llamadas, p), p).toContain('CRED= ');
    expect(linea(r.llamadas, 'ENV firebase deploy')).toContain('CRED=si');
  });
  it('un SITIO igual al PROYECTO o a VITE_FIREBASE_PROJECT_ID, o sin PROYECTO, falla cerrado', () => {
    expect(correr([], { SIMULAR: '1', TRABAJO: 'rec-1', SITIO: 'proyecto-prueba' }).codigo).toBe(1);
    expect(correr([], { SIMULAR: '1', TRABAJO: 'rec-1', VITE_FIREBASE_PROJECT_ID: SITIO }).codigo).toBe(1);
    expect(correr([], { SIMULAR: '1', TRABAJO: 'rec-1', PROYECTO: '' }).codigo).toBe(1);
    expect(correr([], { SIMULAR: '1', TRABAJO: 'rec-1', SITIOS_PROHIBIDOS: `otro-sitio, ${SITIO}` }).codigo).toBe(1);
  });
});

describe('reconstruir-sitio.sh: más fallos con su etapa', () => {
  const fallida = (ll: string[]) => ll.find((l) => l.includes(' fallida ')) ?? '';
  it('si falla la instalación de dependencias, la etapa es «generar»', () => {
    const r = correr([], { TRABAJO: 'rec-1', FALLA: 'instalar' });
    expect(r.codigo).not.toBe(0);
    expect(fallida(r.llamadas)).toContain('--etapa generar');
  });
  it('si falla el humo, la etapa es «humo» y no se certifica ni se completa', () => {
    const r = correr([], { TRABAJO: 'rec-1', CURL_CODIGO: '500' });
    expect(r.codigo).not.toBe(0);
    expect(fallida(r.llamadas)).toContain('--etapa humo');
    expect(r.llamadas.some((l) => l.startsWith('node scripts/certificar-sitio.mjs'))).toBe(false);
    expect(r.llamadas.some((l) => l.includes(' completada'))).toBe(false);
  });
  it('«site not found» en el despliegue: etapa «despliegue», sin humo', () => {
    const r = correr([], { TRABAJO: 'rec-1', FALLA: 'nositio' });
    expect(r.codigo).not.toBe(0);
    expect(r.salida).toContain('no existe en el proyecto');
    expect(fallida(r.llamadas)).toContain('--etapa despliegue');
    expect(r.llamadas.some((l) => l.startsWith('curl'))).toBe(false);
  });
  it('firebase deploy con código distinto de 0: sale con ese código y etapa «despliegue»', () => {
    const r = correr([], { TRABAJO: 'rec-1', RC_DEPLOY: '7' });
    expect(r.codigo).toBe(7);
    expect(fallida(r.llamadas)).toContain('--etapa despliegue');
  });
  it('una hora de inicio inválida no impide cerrar los rezagados', () => {
    const temp = mkdtempSync(join(raiz, 'fases-'));
    expect(correr(['preparar'], { TRABAJO: 'rec-1', RUNNER_TEMP: temp }).codigo).toBe(0);
    writeFileSync(join(temp, 'reconstruir-sitio-a1', 'GENERAR_INICIO_MS'), 'x');
    const r = correr(['desplegar'], { RUNNER_TEMP: temp });
    expect(r.codigo).toBe(1);
    expect(r.llamadas.some((l) => l.includes(' rezagados'))).toBe(true);
    expect(r.llamadas.some((l) => l.includes(' cubiertos'))).toBe(false);
  });
  it('sin el contenido generado, la certificación termina con 3 y cierra fallida en «certificacion»', () => {
    const temp = mkdtempSync(join(raiz, 'fases-'));
    expect(correr(['preparar'], { TRABAJO: 'rec-1', RUNNER_TEMP: temp }).codigo).toBe(0);
    rmSync(join(temp, 'reconstruir-sitio-a1', 'sitio', 'contenido.json'));
    const r = correr(['desplegar'], { RUNNER_TEMP: temp });
    expect(r.codigo).toBe(3);
    expect(fallida(r.llamadas)).toContain('--etapa certificacion');
  });
});

describe('reconstruir-sitio.sh: fases preparar y desplegar', () => {
  it('preparar no despliega ni usa firebase; desplegar completa el trabajo con lo que dejó preparar', () => {
    const temp = mkdtempSync(join(raiz, 'fases-'));
    const a = correr(['preparar'], { TRABAJO: 'rec-1', RUNNER_TEMP: temp });
    expect(a.codigo).toBe(0);
    expect(a.llamadas.some((l) => l.includes('build.mjs'))).toBe(true);
    expect(a.llamadas.some((l) => l.startsWith('firebase') || l.startsWith('curl'))).toBe(false);
    expect(estados(a.llamadas)).toEqual(['rec-1 en_curso']);
    const b = correr(['desplegar'], { RUNNER_TEMP: temp });
    expect(b.codigo).toBe(0);
    expect(b.llamadas.some((l) => l.includes('build.mjs'))).toBe(false);
    expect(b.llamadas.some((l) => l.startsWith('firebase deploy'))).toBe(true);
    expect(estados(b.llamadas)).toEqual(['rec-1 completada']);
    // La certificación posterior compara contra el MISMO contenido que preparar generó.
    expect(b.llamadas.find((l) => l.startsWith('node scripts/certificar-sitio.mjs'))).toContain('--contenido');
  });
  it('desplegar tras un preparar que terminó con 10 también sale con 10 y no hace nada', () => {
    const temp = mkdtempSync(join(raiz, 'fases-'));
    expect(correr(['preparar'], { TRABAJO: 'rec-1', RUNNER_TEMP: temp, RC_ESTADO_en_curso: '3' }).codigo).toBe(10);
    const b = correr(['desplegar'], { RUNNER_TEMP: temp });
    expect(b.codigo).toBe(10);
    expect(b.llamadas).toEqual([]);
  });
  it('desplegar sin preparar falla', () => {
    const temp = mkdtempSync(join(raiz, 'fases-'));
    expect(correr(['desplegar'], { RUNNER_TEMP: temp }).codigo).not.toBe(0);
  });
  it('una falla en preparar cierra fallida; cancelar después no repite el cierre', () => {
    const temp = mkdtempSync(join(raiz, 'fases-'));
    const a = correr(['preparar'], { TRABAJO: 'rec-1', RUNNER_TEMP: temp, FALLA: 'build' });
    expect(a.codigo).not.toBe(0);
    const c = correr(['cancelar'], { RUNNER_TEMP: temp });
    expect(c.codigo).toBe(0);
    expect(c.llamadas).toEqual([]);
  });
  it('cancelar cierra fallida con etapa «cancelado» el trabajo que quedó en_curso', () => {
    const temp = mkdtempSync(join(raiz, 'fases-'));
    expect(correr(['preparar'], { TRABAJO: 'rec-1', RUNNER_TEMP: temp }).codigo).toBe(0);
    const c = correr(['cancelar'], { RUNNER_TEMP: temp });
    expect(c.codigo).toBe(0);
    expect(c.llamadas.find((l) => l.includes(' fallida '))).toContain('--etapa cancelado');
  });
  it('cancelar sin trabajo propio no hace nada', () => {
    const c = correr(['cancelar']);
    expect(c.codigo).toBe(0);
    expect(c.llamadas).toEqual([]);
  });
});

describe('reconstruir-sitio.sh: cancelación real', () => {
  it('una señal durante un hijo largo cierra el trabajo fallida con etapa «cancelado» de inmediato', async () => {
    n += 1;
    const log = join(raiz, `log-${String(n)}.txt`);
    writeFileSync(log, '');
    const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: raiz, RAIZ_REPO: join(raiz, 'repo'), RUNNER_TEMP: mkdtempSync(join(raiz, 't-')), LOG: log, ...BASE, TRABAJO: 'rec-1', DORMIR: 'build' };
    const hijo = spawn('bash', [SCRIPT], { env, stdio: 'ignore' });
    const termino = new Promise<number | null>((ok) => hijo.on('exit', (c) => ok(c)));
    const t0 = Date.now();
    while (!readFileSync(log, 'utf8').includes('dormido')) {
      if (Date.now() - t0 > 15_000) throw new Error('el build no arrancó');
      await new Promise((r) => setTimeout(r, 50));
    }
    const senal = Date.now();
    hijo.kill('SIGTERM');
    const codigo = await termino;
    expect(Date.now() - senal).toBeLessThan(5_000); // el build dormía 30 s: la trampa actuó sin esperarlo
    expect(codigo).toBe(143);
    const ll = readFileSync(log, 'utf8').split('\n');
    expect(ll.find((l) => l.includes(' fallida '))).toContain('--etapa cancelado');
    expect(ll.some((l) => l.includes(' completada'))).toBe(false);
  }, 30_000);
});

describe('reconstruir-sitio.sh cancelar --etapa y cierres únicos', () => {
  const fallidas = (ll: string[]) => ll.filter((l) => l.startsWith('node scripts/contenido-sitio.mjs estado') && l.includes(' fallida '));
  const estado = (temp: string) => join(temp, 'reconstruir-sitio-a1');
  it('si falla la autenticación entre fases, `cancelar --etapa despliegue` cierra fallida/despliegue una sola vez', () => {
    const temp = mkdtempSync(join(raiz, 'fases-'));
    expect(correr(['preparar'], { TRABAJO: 'rec-1', RUNNER_TEMP: temp }).codigo).toBe(0);
    // (aquí el workflow autentica con WIF y falla: no se llama a `desplegar`)
    const c = correr(['cancelar', '--etapa', 'despliegue'], { RUNNER_TEMP: temp });
    expect(c.codigo).toBe(0);
    expect(fallidas(c.llamadas)).toHaveLength(1);
    expect(fallidas(c.llamadas)[0]).toContain('--etapa despliegue');
    // Un segundo `cancelar` (cancelled() tras failure()) no repite el cierre.
    expect(fallidas(correr(['cancelar'], { RUNNER_TEMP: temp }).llamadas)).toHaveLength(0);
  });
  it('con DESPLEGADO (se intentó el cierre completada) `cancelar` no cierra fallida', () => {
    const temp = mkdtempSync(join(raiz, 'fases-'));
    expect(correr(['preparar'], { TRABAJO: 'rec-1', RUNNER_TEMP: temp }).codigo).toBe(0);
    writeFileSync(join(estado(temp), 'DESPLEGADO'), '1');
    const c = correr(['cancelar', '--etapa', 'despliegue'], { RUNNER_TEMP: temp });
    expect(c.codigo).toBe(0);
    expect(c.llamadas).toEqual([]);
  });
  it('si falla el cierre completada deja la marca DESPLEGADO y un cancelar posterior se abstiene', () => {
    const temp = mkdtempSync(join(raiz, 'fases-'));
    expect(correr(['preparar'], { TRABAJO: 'rec-1', RUNNER_TEMP: temp }).codigo).toBe(0);
    expect(correr(['desplegar'], { RUNNER_TEMP: temp, RC_ESTADO_completada: '1' }).codigo).not.toBe(0);
    expect(existsSync(join(estado(temp), 'DESPLEGADO'))).toBe(true);
    expect(correr(['cancelar'], { RUNNER_TEMP: temp }).llamadas).toEqual([]);
  });
  it('`desplegar` sin PREPARADO, con trabajo propio abierto, cierra fallida/despliegue', () => {
    const temp = mkdtempSync(join(raiz, 'fases-'));
    expect(correr(['preparar'], { TRABAJO: 'rec-1', RUNNER_TEMP: temp }).codigo).toBe(0);
    rmSync(join(estado(temp), 'PREPARADO'));
    const r = correr(['desplegar'], { RUNNER_TEMP: temp });
    expect(r.codigo).toBe(1);
    expect(fallidas(r.llamadas)).toHaveLength(1);
    expect(fallidas(r.llamadas)[0]).toContain('--etapa despliegue');
  });
  it('`desplegar` sin el secreto, con trabajo propio abierto, cierra fallida/despliegue', () => {
    const temp = mkdtempSync(join(raiz, 'fases-'));
    expect(correr(['preparar'], { TRABAJO: 'rec-1', RUNNER_TEMP: temp }).codigo).toBe(0);
    const r = correr(['desplegar'], { RUNNER_TEMP: temp, SITIO_RECONSTRUCCION_SECRETO: '' });
    expect(r.codigo).toBe(1);
    // Sin secreto el cierre tampoco puede firmarse: se intenta una vez y el fallo se avisa.
    expect(fallidas(r.llamadas)).toHaveLength(1);
  });
  it('un uso inválido de `cancelar` da 2', () => {
    expect(correr(['cancelar', '--etapa', 'build']).codigo).toBe(2);
    expect(correr(['cancelar', '--otra']).codigo).toBe(2);
  });
  it('una falla en una etapa larga cierra fallida UNA sola vez (el hijo no repite la trampa)', () => {
    for (const falla of ['build', 'pruebas', 'registro']) {
      const r = correr([], { TRABAJO: 'rec-1', FALLA: falla });
      expect(fallidas(r.llamadas), falla).toHaveLength(1);
    }
  });
});
