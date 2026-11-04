/** GET /api/cotizacion — es el handler del núcleo; aquí solo se cablea el lector del almacén. */
import {
  leerCotizacion, manejarCotizacion,
  type AlmacenCotizaciones, type CopiaCotizacion, type Mercado, type RespuestaHttp,
} from '@plataforma/nucleo';

/** Lector de cotizaciones de un tenant sobre el almacén inyectado (Firestore en producción). */
export function lectorCotizacion(almacen: AlmacenCotizaciones, tenantId: string, ahora: () => number): (m: Mercado) => Promise<CopiaCotizacion> {
  return (m) => leerCotizacion(almacen, m, ahora(), { tenantId });
}

export function manejarCotizacionSitio(
  req: { readonly metodo: string; readonly mercado?: string | null },
  leer: (m: Mercado) => Promise<CopiaCotizacion>,
): Promise<RespuestaHttp> {
  return manejarCotizacion(req, leer);
}
