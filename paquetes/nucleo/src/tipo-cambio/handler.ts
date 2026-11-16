/**
 * Handler puro de `GET /api/cotizacion[?mercado=BO|AR]`. No conoce Express ni
 * Cloud Functions: recibe método y consulta, y devuelve estado, encabezados y
 * cuerpo. Sin cotización utilizable no se inventa un precio. Sin `mercado`, cada
 * mercado responde por separado: `cotizaciones` trae los que sí tienen y `errores`
 * los que no (200 si al menos uno responde, 503 si ninguno). Con `mercado`
 * explícito, 200 o 503 de ese mercado. Un mercado sin tipo de cambio no tiene cotización: se omite del pedido
 * general y, pedido por su id, responde 200 con `cotizaciones: {}` y `sinTipoCambio` con su id.
 * `comercial` es obligatorio en `manejarCotizacionDe`.
 */
import { esMercadoDe, mercadosDe, tieneTipoCambio, type ConfiguracionComercial } from '../tenant/mercados.js';
import { COMERCIAL_LEGADO_TRES_MONEDAS, SinCotizacionUtilizable, type CopiaCotizacion, type IdMercado, type Mercado } from './tipos.js';

/** Caché: navegador 60 s, CDN 5 min. */
export const CACHE_COTIZACION = 'public, max-age=60, s-maxage=300';

export interface RespuestaHttp {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly cuerpo: unknown;
}

const JSON_UTF8 = 'application/json; charset=utf-8';

/**
 * LEGADO: responde con la declaración del tenant de tres monedas (mercados BO y AR).
 * @deprecated Usar `manejarCotizacionDe` con la declaración del tenant.
 */
export function manejarCotizacion(
  req: { readonly metodo: string; readonly mercado?: string | null },
  leer: (mercado: Mercado) => Promise<CopiaCotizacion>,
): Promise<RespuestaHttp> {
  return manejarCotizacionDe(req, leer as (mercado: IdMercado) => Promise<CopiaCotizacion<string>>, COMERCIAL_LEGADO_TRES_MONEDAS);
}

export async function manejarCotizacionDe(
  req: { readonly metodo: string; readonly mercado?: string | null },
  leer: (mercado: IdMercado) => Promise<CopiaCotizacion<string>>,
  comercial: ConfiguracionComercial,
): Promise<RespuestaHttp> {
  const sinCache = { 'Content-Type': JSON_UTF8, 'Cache-Control': 'no-store' };
  if (req.metodo.toUpperCase() !== 'GET') {
    return { status: 405, headers: { ...sinCache, Allow: 'GET' }, cuerpo: { error: 'metodo_no_permitido' } };
  }
  let pedidos: readonly IdMercado[] = mercadosDe(comercial).filter((m) => tieneTipoCambio(comercial, m));
  if (req.mercado !== undefined && req.mercado !== null && req.mercado !== '') {
    if (!esMercadoDe(comercial, req.mercado)) return { status: 400, headers: sinCache, cuerpo: { error: 'mercado_invalido' } };
    if (!tieneTipoCambio(comercial, req.mercado)) {
      return { status: 200, headers: { 'Content-Type': JSON_UTF8, 'Cache-Control': CACHE_COTIZACION }, cuerpo: { cotizaciones: {}, sinTipoCambio: [req.mercado] } };
    }
    pedidos = [req.mercado];
  }
  if (pedidos.length === 0) {
    return { status: 200, headers: { 'Content-Type': JSON_UTF8, 'Cache-Control': CACHE_COTIZACION }, cuerpo: { cotizaciones: {} } };
  }
  const cotizaciones: Record<IdMercado, CopiaCotizacion<string>> = {};
  const errores: Record<IdMercado, 'sin_cotizacion'> = {};
  for (const m of pedidos) {
    try {
      cotizaciones[m] = await leer(m);
    } catch (e) {
      if (!(e instanceof SinCotizacionUtilizable)) throw e;
      errores[m] = 'sin_cotizacion';
    }
  }
  const fallidos = Object.keys(errores);
  if (fallidos.length === pedidos.length) {
    const cuerpo = pedidos.length === 1 ? { error: 'sin_cotizacion', mercado: pedidos[0] } : { error: 'sin_cotizacion', errores };
    return { status: 503, headers: { ...sinCache, 'Retry-After': '300' }, cuerpo };
  }
  if (fallidos.length > 0) {
    // Respuesta parcial: sin caché compartida para que el mercado caído se recupere apenas vuelva.
    return { status: 200, headers: sinCache, cuerpo: { cotizaciones, errores } };
  }
  return { status: 200, headers: { 'Content-Type': JSON_UTF8, 'Cache-Control': CACHE_COTIZACION }, cuerpo: { cotizaciones } };
}
