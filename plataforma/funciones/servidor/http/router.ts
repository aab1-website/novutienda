// Enrutador de la función HTTP `api`: rutas públicas del sitio, API de NovuChat y endpoints de reconstrucción.
// Función pura sobre `PeticionHttp`; la Cloud Function solo traduce Express a esta forma y de vuelta.
import type { LimiteTasa } from '@novutienda/nucleo';
import { logger } from 'firebase-functions';
import { duenoDeRuta, rutaEncendida } from '../../../coordinador/rutas-http.js';
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

/**
 * Control de encendido de una ruta para un tenant (L3-3). El rechazo queda en el log con el motivo y la ruta, sin token ni IP.
 * Si el lector de módulos lanza, el error sube y la petición no se sirve.
 */
async function servir(e: Entorno, ruta: string, tenantId: string): Promise<boolean> {
  const ok = await rutaEncendida(e.modulosDelTenant, tenantId, duenoDeRuta(ruta));
  if (!ok) logger.warn('ruta HTTP rechazada', { motivo: 'modulo-apagado', ruta });
  return ok;
}

const rechazoNovuchat = (): RespuestaApi => json(401, { error: 'credencial_invalida' });

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
  // Rutas de tenant fijo: el dueño se controla aquí, antes del manejador (el tenant no sale de una credencial).
  if (RUTAS_SITIO.has(ruta)) {
    if (!(await servir(e, ruta, cfg.tenantId))) return json(404, { error: 'no_encontrado' });
    return manejarSitioPublico(e, req, ruta, cfg);
  }
  // Rutas con tenant de credencial: el manejador llama a `puedeServir` DESPUÉS de autenticar y ANTES de leer datos.
  const puedeServir = (tenantId: string): Promise<boolean> => servir(e, ruta, tenantId);
  switch (ruta) {
    case '/api/novuchat/v1/catalogo':
      return manejarCatalogo(e, peticion, cfg.novuchat, puedeServir);
    case '/api/novuchat/v1/inventario':
      return manejarInventario(e, peticion, cfg.novuchat, puedeServir);
    case '/api/novuchat/v1/pedidos/confirmar':
      // Tenant fijo (el de `tenantPedidos`): mismo rechazo que una credencial mala (D2 = A, sin cambio de contrato).
      if (req.metodo === 'POST' && !(await puedeServir(cfg.novuchat.tenantPedidos))) return rechazoNovuchat();
      return manejarPedido(e, peticion, cfg.novuchat);
    default:
      if (ruta.startsWith('/api/sitio/v1/')) return manejarSitio(e, peticion, cfg.secretoReconstruccion, puedeServir);
      return json(404, { error: 'no_encontrado' });
  }
}
