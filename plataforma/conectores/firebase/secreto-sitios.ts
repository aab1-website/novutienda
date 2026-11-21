// Lectura de un secreto de Secret Manager por REST (`versions/latest:access`) con el token de las credenciales por defecto.
// Se usa para `SITIOS_TENANT` SOLO en modo `google`: no se enlaza con `defineSecret` para no exigir que el secreto exista en el modo
// `github`. Caché en memoria por instancia (5 min, para que una rotación se note). Los errores no incluyen el valor ni la respuesta.
import { ErrorConstructorSitio, leerSitios, type SitioDeConstruccion } from './constructor-sitio.js';

export type FetchSecreto = (
  url: string,
  init: { method: 'GET'; headers: Record<string, string>; redirect: 'error'; signal: AbortSignal },
) => Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>;

export interface OpcionesLectorSitios {
  readonly proyecto: string;
  /** Nombre del secreto (`SITIOS_TENANT`). */
  readonly nombre: string;
  readonly tokenAcceso: () => Promise<string>;
  readonly fetchFn?: FetchSecreto;
  readonly ahora?: () => number;
  readonly vigenciaMs?: number;
}

const RE_PROYECTO = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const RE_SECRETO = /^[A-Za-z0-9_-]{1,255}$/;

export function crearLectorSitios(o: OpcionesLectorSitios): () => Promise<readonly SitioDeConstruccion[]> {
  if (!RE_PROYECTO.test(o.proyecto) || !RE_SECRETO.test(o.nombre)) throw new ErrorConstructorSitio('lector de secreto mal configurado');
  const fetchFn: FetchSecreto = o.fetchFn ?? ((url, init) => fetch(url, init));
  const ahora = o.ahora ?? Date.now;
  const vigencia = o.vigenciaMs ?? 300_000;
  let cache: { readonly valor: readonly SitioDeConstruccion[]; readonly hasta: number } | undefined;
  return async () => {
    if (cache !== undefined && ahora() < cache.hasta) return cache.valor;
    let token: string;
    try {
      token = await o.tokenAcceso();
    } catch {
      throw new ErrorConstructorSitio('sin token de acceso para Secret Manager', 'red');
    }
    let r;
    try {
      r = await fetchFn(`https://secretmanager.googleapis.com/v1/projects/${o.proyecto}/secrets/${o.nombre}/versions/latest:access`, {
        method: 'GET', headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ErrorConstructorSitio('Secret Manager no respondió', 'red');
    }
    if (!r.ok) throw new ErrorConstructorSitio(`Secret Manager rechazó la lectura (estado ${String(r.status)})`, r.status);
    const datos = ((await r.json().catch(() => undefined)) as { payload?: { data?: unknown } } | undefined)?.payload?.data;
    if (typeof datos !== 'string') throw new ErrorConstructorSitio('Secret Manager respondió sin contenido', 'respuesta');
    const valor = leerSitios(Buffer.from(datos, 'base64').toString('utf8'));
    cache = { valor, hasta: ahora() + vigencia };
    return valor;
  };
}
