/**
 * GET /api/disponibilidad?ids=a,b,c — solo «disponible» o «agotado». Nunca devuelve
 * cantidades: el lector inyectado entrega un booleano por producto y nada más.
 */
import { respuestaJson, type RespuestaHttp } from './http.js';

export type Disponibilidad = 'disponible' | 'agotado';

/** Puerto: por cada id conocido, si hay existencia. Los ids desconocidos se omiten. */
export type LectorDisponibilidad = (ids: readonly string[]) => Promise<Readonly<Record<string, boolean>>>;

const RE_ID = /^[a-z0-9][a-z0-9-]{1,59}$/;
export const MAX_IDS = 50;
export const CACHE_DISPONIBILIDAD = 'public, max-age=60, s-maxage=60';

export async function manejarDisponibilidad(
  req: { readonly metodo: string; readonly ids?: string | null },
  leer: LectorDisponibilidad,
): Promise<RespuestaHttp> {
  if (req.metodo.toUpperCase() !== 'GET') return respuestaJson(405, { error: 'metodo_no_permitido' }, { Allow: 'GET' });
  const ids = [...new Set((req.ids ?? '').split(',').map((s) => s.trim()).filter((s) => s !== ''))];
  if (ids.length === 0) return respuestaJson(400, { error: 'ids_requeridos' });
  if (ids.length > MAX_IDS) return respuestaJson(400, { error: 'demasiados_ids', maximo: MAX_IDS });
  if (!ids.every((id) => RE_ID.test(id))) return respuestaJson(400, { error: 'id_invalido' });
  let crudo: Readonly<Record<string, boolean>>;
  try {
    crudo = await leer(ids);
  } catch {
    return respuestaJson(503, { error: 'no_disponible' }, { 'Retry-After': '60' });
  }
  const disponibilidad: Record<string, Disponibilidad> = {};
  for (const id of ids) {
    const v = crudo[id];
    if (typeof v === 'boolean') disponibilidad[id] = v ? 'disponible' : 'agotado';
  }
  return respuestaJson(200, { disponibilidad }, { 'Cache-Control': CACHE_DISPONIBILIDAD });
}
