/**
 * Descarga acotada de las fuentes. `fetch` es inyectable para las pruebas (sin red).
 * El tsconfig del núcleo no incluye tipos de DOM ni de Node: se declaran aquí,
 * mínimos, los globales de Node 22 que se usan (fetch y AbortSignal).
 */
interface SenalLike { readonly aborted: boolean }
declare const AbortSignal: { timeout(ms: number): SenalLike };
declare const fetch: FetchLike;
declare const TextDecoder: new (etiqueta?: string) => { decode(datos?: Uint8Array, o?: { stream?: boolean }): string };

/** Lector del cuerpo en streaming (subconjunto de ReadableStreamDefaultReader). */
export interface LectorCuerpo {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(motivo?: unknown): Promise<void>;
}

export type FetchLike = (url: string, init: { headers: Record<string, string>; redirect: 'error'; signal: SenalLike }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(nombre: string): string | null };
  body: { getReader(): LectorCuerpo } | null;
}>;

export interface OpcionesDescarga {
  readonly fetchFn?: FetchLike;
  readonly esperaMs?: number;
  /** Tope de BYTES del cuerpo (por defecto 512 KiB). */
  readonly bytesMaximos?: number;
}

/**
 * La URL la fija el código (constantes de los parsers); nunca viene de afuera. No sigue redirecciones.
 * El cuerpo se lee en streaming contando BYTES: se aborta al pasar el tope, sin bajar el resto, y se
 * rechaza antes de leer si `content-length` ya lo supera.
 */
export async function bajarTexto(url: string, o: OpcionesDescarga = {}): Promise<string> {
  const f: FetchLike = o.fetchFn ?? ((u, init) => fetch(u, init));
  const tope = o.bytesMaximos ?? 512 * 1024;
  const r = await f(url, {
    headers: { 'user-agent': 'plataforma-cotizacion/1.0', accept: '*/*' },
    redirect: 'error',
    signal: AbortSignal.timeout(o.esperaMs ?? 20_000),
  });
  if (!r.ok) throw new Error(`la fuente respondió ${r.status}`);
  const lector = r.body?.getReader();
  const declarado = Number(r.headers.get('content-length'));
  if (Number.isFinite(declarado) && declarado > tope) {
    await lector?.cancel('demasiado grande').catch(() => undefined);
    throw new Error('la respuesta es demasiado grande');
  }
  if (!lector) return '';
  const decodificador = new TextDecoder('utf-8');
  let total = 0;
  let texto = '';
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > tope) {
      await lector.cancel('demasiado grande').catch(() => undefined);
      throw new Error('la respuesta es demasiado grande');
    }
    texto += decodificador.decode(value, { stream: true });
  }
  return texto + decodificador.decode();
}
