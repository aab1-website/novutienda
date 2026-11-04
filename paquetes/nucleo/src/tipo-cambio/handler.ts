/**
 * Handler puro de `GET /api/cotizacion[?mercado=BO|AR]`. No conoce Express ni
 * Cloud Functions: recibe método y consulta, y devuelve estado, encabezados y
 * cuerpo. Sin cotización utilizable responde 503 (el catálogo no debe mostrar precios inventados).
 */
import { esMercado, MERCADOS, SinCotizacionUtilizable, type CopiaCotizacion, type Mercado } from './tipos.js';

/** Caché: navegador 60 s, CDN 5 min. */
export const CACHE_COTIZACION = 'public, max-age=60, s-maxage=300';

export interface RespuestaHttp {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly cuerpo: unknown;
}

const JSON_UTF8 = 'application/json; charset=utf-8';

export async function manejarCotizacion(
  req: { readonly metodo: string; readonly mercado?: string | null },
  leer: (mercado: Mercado) => Promise<CopiaCotizacion>,
): Promise<RespuestaHttp> {
  const sinCache = { 'Content-Type': JSON_UTF8, 'Cache-Control': 'no-store' };
  if (req.metodo.toUpperCase() !== 'GET') {
    return { status: 405, headers: { ...sinCache, Allow: 'GET' }, cuerpo: { error: 'metodo_no_permitido' } };
  }
  let pedidos: readonly Mercado[] = MERCADOS;
  if (req.mercado !== undefined && req.mercado !== null && req.mercado !== '') {
    if (!esMercado(req.mercado)) return { status: 400, headers: sinCache, cuerpo: { error: 'mercado_invalido' } };
    pedidos = [req.mercado];
  }
  const cotizaciones: Partial<Record<Mercado, CopiaCotizacion>> = {};
  try {
    for (const m of pedidos) cotizaciones[m] = await leer(m);
  } catch (e) {
    if (e instanceof SinCotizacionUtilizable) {
      return { status: 503, headers: { ...sinCache, 'Retry-After': '300' }, cuerpo: { error: 'sin_cotizacion', mercado: e.mercado } };
    }
    throw e;
  }
  return { status: 200, headers: { 'Content-Type': JSON_UTF8, 'Cache-Control': CACHE_COTIZACION }, cuerpo: { cotizaciones } };
}
