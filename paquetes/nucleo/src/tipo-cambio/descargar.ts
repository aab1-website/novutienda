/**
 * Descarga acotada de las fuentes. `fetch` es inyectable para las pruebas (sin red).
 * El tsconfig del núcleo no incluye tipos de DOM ni de Node: se declaran aquí,
 * mínimos, los globales de Node 22 que se usan (fetch y AbortSignal).
 */
interface SenalLike { readonly aborted: boolean }
declare const AbortSignal: { timeout(ms: number): SenalLike };
declare const fetch: FetchLike;

export type FetchLike = (url: string, init: { headers: Record<string, string>; redirect: 'error'; signal: SenalLike }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface OpcionesDescarga {
  readonly fetchFn?: FetchLike;
  readonly esperaMs?: number;
  readonly bytesMaximos?: number;
}

/** La URL la fija el código (constantes de los parsers); nunca viene de afuera. No sigue redirecciones. */
export async function bajarTexto(url: string, o: OpcionesDescarga = {}): Promise<string> {
  const f: FetchLike = o.fetchFn ?? ((u, init) => fetch(u, init));
  const r = await f(url, {
    headers: { 'user-agent': 'plataforma-cotizacion/1.0', accept: '*/*' },
    redirect: 'error',
    signal: AbortSignal.timeout(o.esperaMs ?? 20_000),
  });
  if (!r.ok) throw new Error(`la fuente respondió ${r.status}`);
  const texto = await r.text();
  if (texto.length > (o.bytesMaximos ?? 512 * 1024)) throw new Error('la respuesta es demasiado grande');
  return texto;
}
