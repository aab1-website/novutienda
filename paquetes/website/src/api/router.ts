/**
 * Despachador de las tres rutas dinámicas del sitio. Es una función pura: la Cloud Function
 * (o el servidor de pruebas) traduce su petición a `PeticionApi` y devuelve lo que sale de aquí.
 */
import type { CopiaCotizacion, Mercado } from '@plataforma/nucleo';
import { manejarCotizacionSitio } from './cotizacion.js';
import { manejarContacto, type DepsContacto } from './contacto.js';
import { manejarDisponibilidad, type LectorDisponibilidad } from './disponibilidad.js';
import { respuestaJson, type RespuestaHttp } from './http.js';

export interface PeticionApi {
  readonly metodo: string;
  /** Ruta sin consulta (`/api/cotizacion`). */
  readonly ruta: string;
  readonly consulta: Readonly<Record<string, string | undefined>>;
  readonly cabeceras: Readonly<Record<string, string | undefined>>;
  readonly cuerpo?: unknown;
  readonly origen: string;
}

export interface DepsApi {
  readonly leerCotizacion: (m: Mercado) => Promise<CopiaCotizacion>;
  readonly leerDisponibilidad: LectorDisponibilidad;
  readonly contacto: DepsContacto;
}

export const RUTAS_API = ['/api/cotizacion', '/api/disponibilidad', '/api/contacto'] as const;

export function despacharApi(req: PeticionApi, deps: DepsApi): Promise<RespuestaHttp> {
  const ruta = req.ruta.length > 1 ? req.ruta.replace(/\/+$/, '') : req.ruta;
  switch (ruta) {
    case '/api/cotizacion':
      return manejarCotizacionSitio({ metodo: req.metodo, mercado: req.consulta['mercado'] ?? null }, deps.leerCotizacion);
    case '/api/disponibilidad':
      return manejarDisponibilidad({ metodo: req.metodo, ids: req.consulta['ids'] ?? null }, deps.leerDisponibilidad);
    case '/api/contacto':
      return manejarContacto({ metodo: req.metodo, cabeceras: req.cabeceras, cuerpo: req.cuerpo, origen: req.origen }, deps.contacto);
    default:
      return Promise.resolve(respuestaJson(404, { error: 'no_encontrado' }));
  }
}
