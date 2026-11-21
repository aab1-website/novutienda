// scripts/reconstruir-sitio.sh: los pasos 2 a 9 del job `reconstruir` fuera de GitHub. Se prueba con un PATH de
// sustitutos (node, pnpm, firebase, curl, npm, sleep) que registran cada llamada: no toca la red.
import { spawnSync } from 'node:child_process';
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
case "$n" in
  node)
    case "$1" in
      scripts/contenido-sitio.mjs)
        sub="$2"
        case "$sub" in
          pendiente) echo "\${ID_PENDIENTE:-}" ;;
          estado) v="RC_ESTADO_$4"; exit "\${!v:-0}" ;;
          generar)
            while (( $# > 0 )); do [[ "$1" == --salida ]] && echo '{}' > "$2"; shift; done
            [[ "\${FALLA:-}" == generar ]] && exit 1
            exit 0 ;;
          *) v="RC_SUB_$sub"; exit "\${!v:-0}" ;;
        esac ;;
      scripts/build.mjs) [[ "\${FALLA:-}" == build ]] && exit 1; echo "build de ${SITIO} en ${PROYECTO}"; exit 0 ;;
      scripts/certificar-sitio.mjs)
        c="$LOG.cert"; k=$(( $(cat "$c" 2>/dev/null || echo 0) + 1 )); echo "$k" > "$c"
        IFS=, read -r -a rcs <<<"\${CERT_RCS:-0}"
        exit "\${rcs[$((k - 1))]:-\${rcs[-1]}}" ;;
    esac ;;
  pnpm) [[ "\${FALLA:-}" == pruebas && "$1" == vitest ]] && exit 1; exit 0 ;;
  firebase)
    case "$1" in
      --version) echo 15.37.0 ;;
      deploy) echo "Hosting URL: ${URL_SITIO} tenant ${TENANT} sitio ${SITIO}"; [[ "\${FALLA:-}" == registro ]] && echo "Deploy failed"; exit 0 ;;
      hosting:clone) echo "clon de ${SITIO}"; exit "\${RC_CLON:-0}" ;;
      *) exit 0 ;;
    esac ;;
  curl)
    while (( $# > 0 )); do [[ "$1" == -D ]] && echo "content-security-policy: x" > "$2"; shift; done
    echo -n 200 ;;
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
  it('un 409 al tomar el trabajo termina sin desplegar y en verde', () => {
    const r = correr([], { TRABAJO: 'rec-1', RC_ESTADO_en_curso: '3' });
    expect(r.codigo).toBe(0);
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
    expect(sin.codigo).toBe(0);
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
