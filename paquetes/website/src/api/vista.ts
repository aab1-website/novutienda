/**
 * /api/vista?id=<producto> — contador de vistas reales de la ficha.
 *   POST suma una vista (1 lectura + 1 escritura en el almacén) y devuelve el total.
 *   GET  devuelve el total, con caché de CDN.
 * Es pública y anónima: no guarda ninguna IP ni identificador. El límite por origen es en memoria (puerto
 * `LimiteTasa`), y solo cuentan los productos que existen y están publicados, para que nadie infle ids inventados.
 */
import type { LimiteTasa } from '@novutienda/nucleo';
import { respuestaJson, type RespuestaHttp } from './http.js';

/** Puerto del almacén. `null` = el producto no existe o no está publicado. */
export interface AlmacenVistas {
  leer(id: string): Promise<number | null>;
  sumar(id: string): Promise<number | null>;
}

export interface DepsVista {
  readonly almacen: AlmacenVistas;
  readonly limite: LimiteTasa;
  readonly ahora: () => number;
}

const RE_ID = /^[a-z0-9][a-z0-9-]{1,59}$/;
export const CACHE_VISTA = 'public, max-age=60, s-maxage=60';

/** Solo cuenta lo que viene de las páginas del propio sitio: `Sec-Fetch-Site: same-origin`, o `Origin` con el mismo host. */
export function mismoOrigen(c: Readonly<Record<string, string | undefined>>): boolean {
  if (c['sec-fetch-site'] === 'same-origin') return true;
  const origin = c['origin'];
  if (origin === undefined || origin === '') return false;
  let host: string;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  return [c['x-forwarded-host'], c['host']].some((h) => h !== undefined && h.split(',')[0]!.trim().toLowerCase() === host);
}

export async function manejarVista(
  req: {
    readonly metodo: string;
    readonly id?: string | null;
    readonly origen: string;
    /** Claves de la consulta: solo se admite `id`, para que parámetros basura no esquiven la caché del CDN. */
    readonly claves?: readonly string[];
    readonly cabeceras?: Readonly<Record<string, string | undefined>>;
  },
  deps: DepsVista,
): Promise<RespuestaHttp> {
  const metodo = req.metodo.toUpperCase();
  if (metodo !== 'GET' && metodo !== 'POST') return respuestaJson(405, { error: 'metodo_no_permitido' }, { Allow: 'GET, POST' });
  if ((req.claves ?? []).some((k) => k !== 'id')) return respuestaJson(400, { error: 'parametros_invalidos' });
  if (metodo === 'POST' && !mismoOrigen(req.cabeceras ?? {})) return respuestaJson(403, { error: 'origen_no_permitido' });
  const id = (req.id ?? '').trim();
  if (!RE_ID.test(id)) return respuestaJson(400, { error: 'id_invalido' });
  try {
    if (metodo === 'POST') {
      const lim = await deps.limite.intentar(`vista:${req.origen}`, deps.ahora());
      if (!lim.permitido) return respuestaJson(429, { error: 'demasiadas_solicitudes' }, { 'Retry-After': String(lim.reintentarEnSeg) });
      const n = await deps.almacen.sumar(id);
      return n === null ? respuestaJson(404, { error: 'no_encontrado' }) : respuestaJson(200, { vistas: n });
    }
    const n = await deps.almacen.leer(id);
    return n === null ? respuestaJson(404, { error: 'no_encontrado' }) : respuestaJson(200, { vistas: n }, { 'Cache-Control': CACHE_VISTA });
  } catch {
    return respuestaJson(503, { error: 'no_disponible' }, { 'Retry-After': '60' });
  }
}
