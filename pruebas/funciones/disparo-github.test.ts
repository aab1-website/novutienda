// Conector de GitHub (disparo de la reconstrucción) y su configuración: sin red real, con dobles de `fetch`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ConfiguracionDisparoInvalida, crearDisparoGithub, type FetchDisparo } from '../../plataforma/conectores/github/index.js';
import { disparoSitioDeConfiguracion } from '../../plataforma/funciones/servidor/entorno.js';

const TOKEN = 'github_pat_TOKEN_SECRETO_de_prueba_1234567890';
const REPO = 'organizacion/repositorio-sitio';

interface Llamada { url: string; init: Parameters<FetchDisparo>[1] }
function doble(estados: ReadonlyArray<number | Error | 'colgar'>) {
  const llamadas: Llamada[] = [];
  const fetchFn: FetchDisparo = (url, init) => {
    llamadas.push({ url, init });
    const e = estados[Math.min(llamadas.length - 1, estados.length - 1)] as number | Error | 'colgar';
    if (e === 'colgar') return new Promise((_, rechazar) => init.signal.addEventListener('abort', () => rechazar(new Error('abortado'))));
    if (e instanceof Error) return Promise.reject(e);
    return Promise.resolve({ status: e });
  };
  const esperas: number[] = [];
  const esperar = (ms: number): Promise<void> => { esperas.push(ms); return Promise.resolve(); };
  return { llamadas, fetchFn, esperas, esperar };
}

afterEach(() => vi.restoreAllMocks());

describe('disparo de GitHub', () => {
  it('arma la petición exacta y 204 es éxito en un intento', async () => {
    const d = doble([204]);
    const r = await crearDisparoGithub({ repo: REPO, token: TOKEN, fetchFn: d.fetchFn, esperar: d.esperar }).disparar();
    expect(r).toEqual({ ok: true });
    expect(d.llamadas).toHaveLength(1);
    const { url, init } = d.llamadas[0] as Llamada;
    expect(url).toBe('https://api.github.com/repos/organizacion/repositorio-sitio/actions/workflows/reconstruir-sitio.yml/dispatches');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(JSON.parse(init.body)).toEqual({ ref: 'main', inputs: { clave: 'cola:pendientes' } });
    expect(init.body).toBe('{"ref":"main","inputs":{"clave":"cola:pendientes"}}');
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'plataforma-disparo',
    });
  });

  it('200 con cuerpo (versiones posteriores de la API) también es éxito, en un intento', async () => {
    const d = doble([200]);
    expect(await crearDisparoGithub({ repo: REPO, token: TOKEN, fetchFn: d.fetchFn, esperar: d.esperar }).disparar()).toEqual({ ok: true });
    expect(d.llamadas).toHaveLength(1);
  });

  it('500 dos veces y luego 204: ok con 3 peticiones y esperas de 1 s y 4 s', async () => {
    const d = doble([500, 502, 204]);
    expect(await crearDisparoGithub({ repo: REPO, token: TOKEN, fetchFn: d.fetchFn, esperar: d.esperar }).disparar()).toEqual({ ok: true });
    expect(d.llamadas).toHaveLength(3);
    expect(d.esperas).toEqual([1000, 4000]);
  });

  it('429 se reintenta; si no cede, devuelve el estado tras 3 intentos', async () => {
    const d = doble([429]);
    expect(await crearDisparoGithub({ repo: REPO, token: TOKEN, fetchFn: d.fetchFn, esperar: d.esperar }).disparar()).toEqual({ ok: false, estado: 429 });
    expect(d.llamadas).toHaveLength(3);
  });

  it.each([401, 403, 404, 422])('%i no se reintenta', async (estado) => {
    const d = doble([estado]);
    expect(await crearDisparoGithub({ repo: REPO, token: TOKEN, fetchFn: d.fetchFn, esperar: d.esperar }).disparar()).toEqual({ ok: false, estado });
    expect(d.llamadas).toHaveLength(1);
    expect(d.esperas).toEqual([]);
  });

  it('fallo de red: 3 intentos y estado `red`; nunca lanza', async () => {
    const d = doble([new Error(`ECONNRESET con ${TOKEN}`)]);
    expect(await crearDisparoGithub({ repo: REPO, token: TOKEN, fetchFn: d.fetchFn, esperar: d.esperar }).disparar()).toEqual({ ok: false, estado: 'red' });
    expect(d.llamadas).toHaveLength(3);
  });

  it('tiempo agotado: aborta cada intento, reintenta y devuelve `red`', async () => {
    const d = doble(['colgar']);
    const r = await crearDisparoGithub({ repo: REPO, token: TOKEN, fetchFn: d.fetchFn, esperar: d.esperar, tiempoMaximoMs: 5 }).disparar();
    expect(r).toEqual({ ok: false, estado: 'red' });
    expect(d.llamadas).toHaveLength(3);
  });

  it('una redirección no se sigue ni se reintenta', async () => {
    const d = doble([302]);
    expect(await crearDisparoGithub({ repo: REPO, token: TOKEN, fetchFn: d.fetchFn, esperar: d.esperar }).disparar()).toEqual({ ok: false, estado: 302 });
    expect(d.llamadas).toHaveLength(1);
  });

  it('contra un servidor local: no sigue la redirección (el segundo servidor no recibe nada) y el token no sale', async () => {
    let recibidoAjeno = 0;
    const ajeno = createServer((_q, r) => { recibidoAjeno += 1; r.statusCode = 204; r.end(); });
    await new Promise<void>((ok) => ajeno.listen(0, '127.0.0.1', ok));
    const destino = `http://127.0.0.1:${(ajeno.address() as AddressInfo).port}/ajeno`;
    const peticiones: IncomingMessage[] = [];
    const local = createServer((q, r) => { peticiones.push(q); r.statusCode = 307; r.setHeader('Location', destino); r.end(); });
    await new Promise<void>((ok) => local.listen(0, '127.0.0.1', ok));
    const base = `http://127.0.0.1:${(local.address() as AddressInfo).port}`;
    try {
      // Se reescribe solo el host (el conector fija https://api.github.com); el resto de la petición real viaja por el `fetch` global.
      const fetchFn: FetchDisparo = (url, init) => fetch(url.replace('https://api.github.com', base), init);
      const r = await crearDisparoGithub({ repo: REPO, token: TOKEN, fetchFn, esperar: () => Promise.resolve() }).disparar();
      expect(r).toEqual({ ok: false, estado: 307 });
      expect(peticiones).toHaveLength(1);
      expect(peticiones[0]?.method).toBe('POST');
      expect(peticiones[0]?.url).toBe('/repos/organizacion/repositorio-sitio/actions/workflows/reconstruir-sitio.yml/dispatches');
      expect(recibidoAjeno).toBe(0);
    } finally {
      local.close(); ajeno.close();
    }
  });

  it('repo o token inválidos: error de configuración sin el valor', () => {
    for (const repo of ['', 'solo-nombre', 'a/b/c', 'a/b c', '../x', 'a/..', 'a/b?x=1', '/']) {
      expect(() => crearDisparoGithub({ repo, token: TOKEN })).toThrow(ConfiguracionDisparoInvalida);
    }
    expect(() => crearDisparoGithub({ repo: REPO, token: 'corto' })).toThrow(ConfiguracionDisparoInvalida);
    try { crearDisparoGithub({ repo: REPO, token: 'con espacio y mucho texto aqui' }); } catch (e) { expect(String(e)).not.toContain('espacio'); }
  });

  it('el token no aparece en los logs ni en el valor devuelto', async () => {
    const registros: unknown[] = [];
    for (const flujo of [process.stdout, process.stderr]) vi.spyOn(flujo, 'write').mockImplementation((...a: unknown[]) => { registros.push(a); return true; });
    const consola = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const d = doble([new Error(TOKEN), 401]);
    const r = await crearDisparoGithub({ repo: REPO, token: TOKEN, fetchFn: d.fetchFn, esperar: d.esperar }).disparar();
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(JSON.stringify(registros) + JSON.stringify(consola.mock.calls)).not.toContain(TOKEN);
  });
});

describe('disparo de GitHub: configuración', () => {
  const avisos: string[] = [];
  const avisar = (m: string): void => { avisos.push(m); };
  afterEach(() => { avisos.length = 0; });

  it('parámetro o secreto vacíos: deshabilitado con un aviso informativo sin valores', () => {
    expect(disparoSitioDeConfiguracion('', TOKEN, {}, avisar)).toBeUndefined();
    expect(disparoSitioDeConfiguracion(REPO, '', {}, avisar)).toBeUndefined();
    expect(avisos).toHaveLength(2);
    expect(avisos.join('')).not.toContain(TOKEN);
  });

  it('repo inválido o token con forma de marcador: deshabilitado sin lanzar', () => {
    expect(disparoSitioDeConfiguracion('no es repo', TOKEN, {}, avisar)).toBeUndefined();
    expect(disparoSitioDeConfiguracion(REPO, 'pendiente', {}, avisar)).toBeUndefined();
    expect(avisos.join('')).not.toContain('pendiente');
  });

  it('en el emulador y en pruebas nunca hay disparo, aunque haya configuración', () => {
    expect(disparoSitioDeConfiguracion(REPO, TOKEN, { FUNCTIONS_EMULATOR: 'true' }, avisar)).toBeUndefined();
    expect(disparoSitioDeConfiguracion(REPO, TOKEN, { PLATAFORMA_PRUEBAS: '1' }, avisar)).toBeUndefined();
  });

  it('configuración válida fuera de pruebas: arma el disparo', () => {
    expect(disparoSitioDeConfiguracion(REPO, TOKEN, {}, avisar)?.disparar).toBeTypeOf('function');
  });
});
