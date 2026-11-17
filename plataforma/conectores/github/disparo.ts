// Conector de GitHub: avisa a Actions para que reconstruya el sitio sin esperar el sondeo programado (S7-3, DS-3).
// Sirve al coordinador (temporizador del sitio); los módulos no lo importan. Es una función pura e inyectable: el `fetch`,
// la espera y el reloj se pasan por parámetro, de modo que las pruebas y el emulador nunca tocan la red real.
//
// Contrato de GitHub (documentación oficial «Create a workflow dispatch event», consultada el 17/11/2026):
//   POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches · éxito = 2xx (204 sin cuerpo con la versión
//   2022-11-28; 200 con cuerpo en las posteriores). Permiso del token de grano fino: «Actions», escritura.
//   Cabeceras: `Accept: application/vnd.github+json` y `X-GitHub-Api-Version: 2022-11-28` (verificado en la documentación
//   oficial el 17/11/2026: versión por defecto, con soporte hasta el 10/03/2028; la siguiente es 2026-03-10).
//   Permiso del token de grano fino: «Actions» de escritura sobre el repositorio (nada más).
//
// Seguridad: NUNCA lanza hacia el llamador y NUNCA registra ni devuelve el token, la URL con datos ni el cuerpo de la respuesta;
// el único dato que sale es el código de estado (o `'red'`). Sin redirecciones: una 3xx no se sigue (el token no viaja a otro host).

export type ResultadoDisparo = { readonly ok: true } | { readonly ok: false; readonly estado: number | 'red' };

export interface DisparoGithub {
  disparar(): Promise<ResultadoDisparo>;
}

/** Subconjunto de `fetch` que usa el conector (lo cumple `fetch` global y un doble de pruebas). */
export type FetchDisparo = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; redirect: 'manual'; signal: AbortSignal },
) => Promise<{ readonly status: number }>;

export interface OpcionesDisparo {
  /** `owner/nombre` del repositorio que contiene el workflow. */
  readonly repo: string;
  /** Token de grano fino (solo «Actions» de escritura). Nunca se registra. */
  readonly token: string;
  readonly fetchFn?: FetchDisparo;
  /** Espera entre intentos (milisegundos). Por defecto, un temporizador real. */
  readonly esperar?: (ms: number) => Promise<void>;
  readonly ahora?: () => number;
  /** Tiempo máximo por intento. Por defecto 10 s. */
  readonly tiempoMaximoMs?: number;
}

export class ConfiguracionDisparoInvalida extends Error {
  constructor(que: 'repo' | 'token') {
    super(`Configuración del disparo de GitHub inválida: ${que}`);
    this.name = 'ConfiguracionDisparoInvalida';
  }
}

export const WORKFLOW_SITIO = 'reconstruir-sitio.yml';
export const RAMA_SITIO = 'main';
/** Valor reservado de la entrada `clave` del workflow: «reconstruir los sitios con trabajo pendiente». */
export const CLAVE_COLA_PENDIENTES = 'cola:pendientes';
export const VERSION_API_GITHUB = '2022-11-28';

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
/** Forma de un token de GitHub (`github_pat_…`, `ghp_…`): solo letras, números y guion bajo. Un marcador de posición corto no pasa. */
const TOKEN = /^[A-Za-z0-9_]{20,255}$/;
const ESPERAS_MS = [1000, 4000] as const;
const INTENTOS = 3;
const TIEMPO_MAXIMO_POR_DEFECTO_MS = 10_000;

export function repoValido(repo: string): boolean {
  return REPO.test(repo) && repo !== '/' && !repo.split('/').some((p) => p === '.' || p === '..');
}

export function tokenValido(token: string): boolean {
  return TOKEN.test(token);
}

const esperaReal = (ms: number): Promise<void> => new Promise((resolver) => setTimeout(resolver, ms));
const reintentable = (estado: number): boolean => estado === 429 || estado >= 500;

/** Crea el disparo; lanza `ConfiguracionDisparoInvalida` (sin el valor) si `repo` o `token` no tienen la forma esperada. */
export function crearDisparoGithub(o: OpcionesDisparo): DisparoGithub {
  if (!repoValido(o.repo)) throw new ConfiguracionDisparoInvalida('repo');
  if (!tokenValido(o.token)) throw new ConfiguracionDisparoInvalida('token');
  const fetchFn: FetchDisparo = o.fetchFn ?? ((url, init) => fetch(url, init));
  const esperar = o.esperar ?? esperaReal;
  const ahora = o.ahora ?? Date.now;
  const tiempoMaximo = o.tiempoMaximoMs ?? TIEMPO_MAXIMO_POR_DEFECTO_MS;
  const url = `https://api.github.com/repos/${o.repo}/actions/workflows/${WORKFLOW_SITIO}/dispatches`;
  const cuerpo = JSON.stringify({ ref: RAMA_SITIO, inputs: { clave: CLAVE_COLA_PENDIENTES } });
  const cabeceras = {
    Authorization: `Bearer ${o.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': VERSION_API_GITHUB,
    'User-Agent': 'plataforma-disparo',
    'Content-Type': 'application/json',
  };

  async function intento(): Promise<ResultadoDisparo> {
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), tiempoMaximo);
    try {
      const r = await fetchFn(url, { method: 'POST', headers: cabeceras, body: cuerpo, redirect: 'manual', signal: control.signal });
      // Éxito = cualquier 2xx: la versión 2022-11-28 responde 204 sin cuerpo y las posteriores 200 con el id de la corrida.
      return r.status >= 200 && r.status < 300 ? { ok: true } : { ok: false, estado: r.status };
    } catch {
      return { ok: false, estado: 'red' };
    } finally {
      clearTimeout(reloj);
    }
  }

  return {
    async disparar() {
      const inicio = ahora();
      let ultimo: ResultadoDisparo = { ok: false, estado: 'red' };
      for (let i = 0; i < INTENTOS; i += 1) {
        ultimo = await intento();
        if (ultimo.ok) return ultimo;
        if (ultimo.estado !== 'red' && !reintentable(ultimo.estado)) return ultimo;
        const espera = ESPERAS_MS[i];
        if (espera === undefined) break;
        // Tope total: si ya se gastó casi toda la corrida del temporizador, no se sigue insistiendo.
        if (ahora() - inicio > 40_000) break;
        try {
          await esperar(espera);
        } catch {
          break;
        }
      }
      return ultimo;
    },
  };
}
