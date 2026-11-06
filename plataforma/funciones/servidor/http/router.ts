// Enrutador de la función HTTP `api`: rutas públicas del sitio, API de NovuChat y endpoints de reconstrucción.
// Función pura sobre `PeticionHttp`; la Cloud Function solo traduce Express a esta forma y de vuelta.
import type { LimiteTasa } from '@novutienda/nucleo';
import type { Entorno } from '../entorno.js';
import { manejarCatalogo, manejarInventario, manejarPedido, type ConfigNovuchat } from './novuchat.js';
import { manejarSitio } from './sitio.js';
import { manejarSitioPublico, type ConfigWebsite } from './website.js';
import { json, type PeticionHttp, type RespuestaApi } from './tipos.js';

export interface ConfigRouter extends Pick<ConfigWebsite, 'recaptcha' | 'appCheck'> {
  readonly tenantId: string;
  readonly novuchat: ConfigNovuchat;
  readonly secretoReconstruccion: string;
  readonly limiteContacto: LimiteTasa;
  /** Límites en memoria por instancia y por origen, ANTES de autenticar (NovuChat), de leer (disponibilidad) o de verificar App Check (contacto). */
  readonly limiteMemoria: { readonly novuchat: LimiteTasa; readonly disponibilidad: LimiteTasa; readonly contacto: LimiteTasa };
}

const RUTAS_SITIO = new Set(['/api/cotizacion', '/api/disponibilidad', '/api/contacto']);

async function excedeLimite(limite: LimiteTasa, clave: string, ahora: number): Promise<RespuestaApi | undefined> {
  const r = await limite.intentar(clave, ahora);
  return r.permitido ? undefined : json(429, { error: 'limite' }, { 'Retry-After': String(r.reintentarEnSeg) });
}

export async function enrutar(e: Entorno, req: PeticionHttp, cfg: ConfigRouter): Promise<RespuestaApi> {
  const ruta = req.ruta.length > 1 ? req.ruta.replace(/\/+$/, '') : req.ruta;
  const peticion = { ...req, ruta };
  // Sonda de salud (la usa el despliegue): responde sin tocar ninguna dependencia. La ruta pública es `/api/salud`:
  // el frontend de Google intercepta exactamente `/healthz` en Cloud Run (devuelve su propio 404 HTML sin llegar al
  // contenedor; `/healthz/` y cualquier otra ruta sí llegan), así que `/healthz` queda solo para el emulador y las pruebas.
  if (ruta === '/healthz' || ruta === '/api/salud') {
    return { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, cuerpo: 'ok' };
  }
  if (ruta === '/api/disponibilidad') {
    const limitado = await excedeLimite(cfg.limiteMemoria.disponibilidad, `disponibilidad:${req.origen}`, e.ahora());
    if (limitado !== undefined) return limitado;
  } else if (ruta === '/api/contacto') {
    // Antes de App Check: verificar y consumir un token cuesta una llamada a Google; el límite de Firestore por origen va después.
    const limitado = await excedeLimite(cfg.limiteMemoria.contacto, `contacto:${req.origen}`, e.ahora());
    if (limitado !== undefined) return limitado;
  } else if (ruta.startsWith('/api/novuchat/')) {
    // Antes de autenticar: un token inventado ya cuesta una lectura de Firestore.
    const limitado = await excedeLimite(cfg.limiteMemoria.novuchat, `novuchat:${req.origen}`, e.ahora());
    if (limitado !== undefined) return limitado;
  }
  if (RUTAS_SITIO.has(ruta)) return manejarSitioPublico(e, req, ruta, cfg);
  switch (ruta) {
    case '/api/novuchat/v1/catalogo':
      return manejarCatalogo(e, peticion, cfg.novuchat);
    case '/api/novuchat/v1/inventario':
      return manejarInventario(e, peticion, cfg.novuchat);
    case '/api/novuchat/v1/pedidos/confirmar':
      return manejarPedido(e, peticion, cfg.novuchat);
    default:
      if (ruta.startsWith('/api/sitio/v1/')) return manejarSitio(e, peticion, cfg.secretoReconstruccion);
      return json(404, { error: 'no_encontrado' });
  }
}
