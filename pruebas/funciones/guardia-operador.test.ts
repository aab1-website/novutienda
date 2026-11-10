// Guardias compartidas de los scripts de operador (`scripts/guardia-operador.mjs`): entorno y rutas de archivos con secretos.
// Se importa el módulo real. Las rutas se prueban contra el repositorio real (el módulo decide con el git del propio
// checkout), usando rutas que no existen o directorios temporales: no se escribe nada en el repositorio.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

interface Guardia {
  validarEntorno(o: { proyectoArg: string | undefined; hostsEmulador: readonly string[]; env?: Record<string, string | undefined> }): { proyecto: string; ambiente: string; enEmulador: boolean };
  exigirFueraDelRepositorio(ruta: string, etiqueta?: string): void;
}
const ruta = '../../scripts/guardia-operador.mjs';
const { validarEntorno, exigirFueraDelRepositorio } = (await import(/* @vite-ignore */ ruta)) as Guardia;

const HOSTS_PERSONAL = ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST'];
const HOSTS_DEMO = [...HOSTS_PERSONAL, 'FIREBASE_STORAGE_EMULATOR_HOST'];
const EMU = { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199' };

describe('guardia de entorno', () => {
  const stg = { GOOGLE_CLOUD_PROJECT: 'proyecto-stg', NOVUTIENDA_AMBIENTE: 'staging', GCP_PROJECT_ID_STAGING: 'proyecto-stg' };
  const emu = { GOOGLE_CLOUD_PROJECT: 'demo-x', NOVUTIENDA_AMBIENTE: 'emulador', ...EMU };
  const v = (env: Record<string, string | undefined>, proyectoArg: string | undefined, hosts = HOSTS_DEMO) => () => validarEntorno({ proyectoArg, hostsEmulador: hosts, env });

  it('acepta staging sin emulador y emulador completo con demo-*', () => {
    expect(v(stg, 'proyecto-stg')()).toEqual({ proyecto: 'proyecto-stg', ambiente: 'staging', enEmulador: false });
    expect(v(emu, 'demo-x')()).toMatchObject({ ambiente: 'emulador', enEmulador: true });
  });

  it('exige GOOGLE_CLOUD_PROJECT, --proyecto y que coincidan', () => {
    expect(v({ NOVUTIENDA_AMBIENTE: 'staging' }, 'x')).toThrow(/GOOGLE_CLOUD_PROJECT/);
    expect(v(stg, undefined)).toThrow(/--proyecto/);
    expect(v(stg, '--aplicar')).toThrow(/--proyecto/);
    expect(v(stg, 'otro')).toThrow(/no coincide/);
  });

  it('exige NOVUTIENDA_AMBIENTE = staging | emulador', () => {
    expect(v({ GOOGLE_CLOUD_PROJECT: 'proyecto-stg' }, 'proyecto-stg')).toThrow(/NOVUTIENDA_AMBIENTE/);
    expect(v({ ...stg, NOVUTIENDA_AMBIENTE: 'prod' }, 'proyecto-stg')).toThrow(/NOVUTIENDA_AMBIENTE/);
    expect(v({ ...stg, NOVUTIENDA_AMBIENTE: 'production' }, 'proyecto-stg')).toThrow(/NOVUTIENDA_AMBIENTE/);
  });

  it('rechaza el proyecto de producción (GCP_PROJECT_ID_PROD) y no nombra identificadores', () => {
    expect(v({ ...stg, GCP_PROJECT_ID_PROD: 'proyecto-stg' }, 'proyecto-stg')).toThrow(/producción/);
    try {
      v({ ...stg, GCP_PROJECT_ID_PROD: 'proyecto-stg' }, 'proyecto-stg')();
    } catch (e) {
      expect((e as Error).message).not.toContain('proyecto-stg');
    }
    // Un id de producción distinto o vacío no bloquea staging.
    expect(v({ ...stg, GCP_PROJECT_ID_PROD: 'otro-id' }, 'proyecto-stg')().ambiente).toBe('staging');
    expect(v({ ...stg, GCP_PROJECT_ID_PROD: '' }, 'proyecto-stg')().ambiente).toBe('staging');
  });

  it('sin emulador exige GCP_PROJECT_ID_STAGING definida, válida e igual al proyecto', () => {
    const sinStaging: Record<string, string | undefined> = { ...stg, GCP_PROJECT_ID_STAGING: undefined };
    expect(v(sinStaging, 'proyecto-stg')).toThrow(/GCP_PROJECT_ID_STAGING/);
    expect(v({ ...stg, GCP_PROJECT_ID_STAGING: '  ' }, 'proyecto-stg')).toThrow(/GCP_PROJECT_ID_STAGING/);
    expect(v({ ...stg, GCP_PROJECT_ID_STAGING: 'otro-proyecto' }, 'proyecto-stg')).toThrow(/no es el de staging/);
    // Ids con formato inválido (mayúsculas, guion al final, muy cortos o con caracteres ajenos).
    for (const malo of ['Proyecto-Stg', 'proyecto-stg-', 'abc', '1proyecto', 'proyecto_stg']) {
      expect(v({ ...stg, GOOGLE_CLOUD_PROJECT: malo, GCP_PROJECT_ID_STAGING: malo }, malo)).toThrow(/formato/);
    }
    // Normaliza espacios y con producción definida y distinta sigue pasando.
    expect(v({ ...stg, GCP_PROJECT_ID_STAGING: ' proyecto-stg ' }, 'proyecto-stg')().proyecto).toBe('proyecto-stg');
    expect(() => v({ ...stg, GCP_PROJECT_ID_STAGING: 'otro-proyecto' }, 'proyecto-stg')()).toThrow(/^(?!.*proyecto-stg)/);
    // El emulador no exige GCP_PROJECT_ID_STAGING.
    expect(v(emu, 'demo-x')().enEmulador).toBe(true);
  });

  it('emulador completo o ninguno: con uno solo de los hosts (también sin Storage en demo) falla', () => {
    expect(v({ ...stg, FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' }, 'proyecto-stg')).toThrow(/todas las variables de emulador/);
    const sinStorage: Record<string, string | undefined> = { ...emu, FIREBASE_STORAGE_EMULATOR_HOST: undefined };
    expect(v(sinStorage, 'demo-x')).toThrow(/todas las variables de emulador/);
    // Para el script de personal (Auth + Firestore) Storage no se exige.
    expect(v(sinStorage, 'demo-x', HOSTS_PERSONAL)().enEmulador).toBe(true);
    expect(v({ ...emu, FIRESTORE_EMULATOR_HOST: '' }, 'demo-x')).toThrow(/todas las variables de emulador/);
  });

  it('con emulador exige demo-* y ambiente emulador; sin emulador, staging y nunca demo-*', () => {
    expect(v({ ...emu, GOOGLE_CLOUD_PROJECT: 'real-1' }, 'real-1')).toThrow(/demo-\*/);
    expect(v({ ...emu, NOVUTIENDA_AMBIENTE: 'staging' }, 'demo-x')).toThrow(/emulador/);
    expect(v({ GOOGLE_CLOUD_PROJECT: 'proyecto-stg', NOVUTIENDA_AMBIENTE: 'emulador' }, 'proyecto-stg')).toThrow(/staging/);
    expect(v({ GOOGLE_CLOUD_PROJECT: 'demo-x', NOVUTIENDA_AMBIENTE: 'staging' }, 'demo-x')).toThrow(/demo-\*/);
  });
});

describe('guardia de rutas con git', () => {
  const aqui = dirname(new URL(import.meta.url).pathname);
  const toplevel = resolve(aqui, '../..');
  const comun = resolve(toplevel, execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: toplevel, encoding: 'utf8' }).trim());
  const principal = dirname(comun); // checkout principal (el worktree comparte el .git)
  const temporales: string[] = [];
  afterAll(() => {
    for (const t of temporales) rmSync(t, { recursive: true, force: true });
  });

  it('acepta una ruta fuera de todo árbol del repositorio', () => {
    const t = mkdtempSync(join(tmpdir(), 'guardia-'));
    temporales.push(t);
    expect(() => exigirFueraDelRepositorio(join(t, 'credenciales.json'))).not.toThrow();
    expect(() => exigirFueraDelRepositorio(join(t, 'no-existe', 'sub', 'x.json'))).not.toThrow();
  });

  it('rechaza una ruta versionada dentro del repositorio (checkout actual)', () => {
    expect(() => exigirFueraDelRepositorio(join(toplevel, 'package.json'), 'el archivo de credenciales')).toThrow(/fuera del repositorio o ignorado/);
    expect(() => exigirFueraDelRepositorio(join(toplevel, 'scripts', 'nuevo.json'))).toThrow(/fuera del repositorio o ignorado/);
  });

  it('rechaza una ruta no ignorada dentro del checkout principal', () => {
    expect(() => exigirFueraDelRepositorio(join(principal, 'package.json'))).toThrow(/fuera del repositorio o ignorado/);
  });

  it('una carpeta cuyo nombre empieza con «..» (p. ej. «..x/») es una ruta dentro del repositorio, no «fuera»', () => {
    expect(() => exigirFueraDelRepositorio(join(toplevel, '..x', 'credenciales.json'))).toThrow(/fuera del repositorio o ignorado/);
    expect(() => exigirFueraDelRepositorio(join(principal, '..x', 'credenciales.json'))).toThrow(/fuera del repositorio o ignorado/);
  });

  it('una ruta con «..» que sale del repositorio se normaliza y se acepta si cae fuera', () => {
    const t = mkdtempSync(join(tmpdir(), 'guardia-'));
    temporales.push(t);
    expect(() => exigirFueraDelRepositorio(join(toplevel, '..', '..', '..', '..', t, 'c.json'))).not.toThrow();
  });

  it('la ruta del plan CLIENTES/CASA_BERMEJO/staging/credenciales.json (ignorada) se acepta desde el checkout y desde el worktree', () => {
    const rel = join('CLIENTES', 'CASA_BERMEJO', 'staging', 'credenciales.json');
    expect(() => exigirFueraDelRepositorio(join(toplevel, rel))).not.toThrow();
    expect(() => exigirFueraDelRepositorio(join(principal, rel))).not.toThrow();
  });

  it('rechaza los archivos de CLIENTES si dejaran de estar ignorados: la carpeta vecina «CLIENTES2» sí se rechaza', () => {
    expect(() => exigirFueraDelRepositorio(join(toplevel, 'CLIENTES2', 'credenciales.json'))).toThrow(/fuera del repositorio o ignorado/);
  });

  it('rechaza un enlace simbólico en un tmp que apunta dentro del repositorio (al archivo o a la carpeta)', () => {
    const t = mkdtempSync(join(tmpdir(), 'guardia-'));
    temporales.push(t);
    symlinkSync(join(toplevel, 'package.json'), join(t, 'enlace.json'));
    expect(() => exigirFueraDelRepositorio(join(t, 'enlace.json'))).toThrow(/enlace simbólico/);
    symlinkSync(join(toplevel, 'scripts'), join(t, 'carpeta'));
    expect(() => exigirFueraDelRepositorio(join(t, 'carpeta', 'credenciales.json'))).toThrow(/fuera del repositorio o ignorado/);
    // El .tmp de las credenciales también se valida: un .tmp que es enlace se rechaza.
    symlinkSync(join(toplevel, 'package.json'), join(t, 'credenciales.json.tmp'));
    expect(() => exigirFueraDelRepositorio(join(t, 'credenciales.json.tmp'), 'el archivo temporal')).toThrow(/enlace simbólico/);
  });

  it('el mensaje lleva la etiqueta indicada y no la ruta', () => {
    try {
      exigirFueraDelRepositorio(join(toplevel, 'package.json'), 'el archivo de credenciales');
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toMatch(/^el archivo de credenciales debe estar/);
      expect((e as Error).message).not.toContain(toplevel);
    }
  });
});

interface Fixtures {
  cargarFixtures(carpeta?: string): { catalogoCsv: string; fixture: { fichas: unknown[] }; bytesFoto: Record<string, number>; tipos: Record<string, string> };
  nombreFotoValido(n: unknown): boolean;
  tipoContenidoFoto(a: string): string;
  intentosEspera(bytes: number): number;
}
const rutaFx = '../../scripts/demo-fixtures.mjs';
const { cargarFixtures, nombreFotoValido, tipoContenidoFoto, intentosEspera } = (await import(/* @vite-ignore */ rutaFx)) as Fixtures;

describe('carpeta de fixtures (--fixtures)', () => {
  const toplevel = resolve(dirname(new URL(import.meta.url).pathname), '../..');
  const temporales: string[] = [];
  afterAll(() => {
    for (const t of temporales) rmSync(t, { recursive: true, force: true });
  });
  const carpeta = (fotos: string[]): string => {
    const t = mkdtempSync(join(tmpdir(), 'fixtures-'));
    temporales.push(t);
    mkdirSync(join(t, 'fotos'));
    writeFileSync(join(t, 'catalogo.csv'), 'id,nombre\nx,X\n');
    writeFileSync(join(t, 'demo.json'), JSON.stringify({ fichas: [{ productoId: 'x', fotos: fotos.map((archivo) => ({ archivo, alt: 'a' })) }] }));
    for (const f of fotos) if (!f.includes('/') && !f.includes('..')) writeFileSync(join(t, 'fotos', f), Buffer.from([1, 2, 3]));
    return t;
  };

  it('la carpeta de fábrica se acepta sin guardia; una fuera del repositorio se acepta', () => {
    expect(cargarFixtures().fixture.fichas.length).toBeGreaterThan(0);
    const r = cargarFixtures(carpeta(['a.png', 'b.jpg', 'c.webp']));
    expect(r.tipos).toEqual({ 'a.png': 'image/png', 'b.jpg': 'image/jpeg', 'c.webp': 'image/webp' });
    expect(r.bytesFoto['a.png']).toBe(3);
  });

  it('una carpeta dentro del repositorio y no ignorada se rechaza; una ignorada (CLIENTES/) pasa la guardia', () => {
    expect(() => cargarFixtures(join(toplevel, 'scripts', 'otros-fixtures'))).toThrow(/fuera del repositorio o ignorado/);
    expect(() => cargarFixtures(join(toplevel, 'paquetes'))).toThrow(/fuera del repositorio o ignorado/);
    expect(() => cargarFixtures(join(toplevel, 'CLIENTES', 'x', 'fixtures'))).toThrow(/no se pudo leer/);
  });

  it('los nombres de foto con «/», «\\» o «..» se rechazan', () => {
    for (const malo of ['../x.png', 'a/../b.png', 'sub/a.png', 'a\\b.png', '..', '', 'a..png']) {
      expect(nombreFotoValido(malo), malo).toBe(false);
    }
    expect(nombreFotoValido('foto-1.JPG')).toBe(true);
    expect(() => cargarFixtures(carpeta(['../fuera.png']))).toThrow(/nombre de foto/);
    expect(() => cargarFixtures(carpeta(['sub/a.png']))).toThrow(/nombre de foto/);
  });

  it('contentType según la extensión y rechazo de otras; la espera crece con el tamaño y tiene tope', () => {
    expect(tipoContenidoFoto('a.JPEG')).toBe('image/jpeg');
    expect(tipoContenidoFoto('a.heic')).toBe('image/heic');
    expect(() => tipoContenidoFoto('a.gif')).toThrow(/extensión/);
    expect(() => cargarFixtures(carpeta(['a.gif']))).toThrow(/extensión/);
    expect(intentosEspera(1000)).toBeLessThan(intentosEspera(8 * 1024 * 1024));
    expect(intentosEspera(15 * 1024 * 1024)).toBeLessThanOrEqual(120);
  });
});
