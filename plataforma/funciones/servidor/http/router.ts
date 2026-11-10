// Enrutador de la función HTTP `api`: rutas públicas del sitio, API de NovuChat y endpoints de reconstrucción.
// Función pura sobre `PeticionHttp`; la Cloud Function solo traduce Express a esta forma y de vuelta.
import type { LimiteTasa } from '@novutienda/nucleo';
import { logger } from 'firebase-functions';
import { hostDePeticion } from '../../../coordinador/dominios.js';
import { duenoDeRuta, rutaEncendida } from '../../../coordinador/rutas-http.js';
import type { Entorno } from '../entorno.js';
import { manejarCatalogo, manejarInventario, manejarPedido, type ConfigNovuchat } from './novuchat.js';
import { manejarSitio } from './sitio.js';
import { manejarSitioPublico, type ConfigWebsite } from './website.js';
import { json, type PeticionHttp, type RespuestaApi } from './tipos.js';

export interface ConfigRouter extends Pick<ConfigWebsite, 'recaptcha' | 'appCheck'> {
  readonly novuchat: ConfigNovuchat;
  readonly secretoReconstruccion: string;
  readonly limiteContacto: LimiteTasa;
  /** Límites en memoria por instancia y por origen, ANTES de autenticar (NovuChat), de leer (disponibilidad) o de verificar App Check (contacto); `hosts` (por origen) y `hostsGlobal` (clave fija `hosts:*`, tope de la instancia), ante un host que no está en caché. */
  readonly limiteMemoria: { readonly novuchat: LimiteTasa; readonly disponibilidad: LimiteTasa; readonly contacto: LimiteTasa; readonly hosts: LimiteTasa; readonly hostsGlobal: LimiteTasa };
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
  const dueno = duenoDeRuta(ruta);
  const ok = await rutaEncendida(e.modulosDelTenant, tenantId, dueno);
  if (!ok) {
    // Motivo distinguible en el log (la respuesta no lo distingue). El lector tiene caché: la segunda consulta no cuesta una lectura.
    const motivo = dueno === undefined ? 'ruta-sin-dueno' : (await e.modulosDelTenant(tenantId)) === undefined ? 'sin-documento' : 'modulo-apagado';
    logger.warn('ruta HTTP rechazada', { motivo, ruta, tenantId });
  }
  return ok;
}

/**
 * Tenant de una ruta pública (sitio o pedido firmado): sale del host y de la lista cerrada `dominios`. `undefined` = rechazo (404).
 * Un host fuera de la caché cuesta una lectura de Firestore: pasa antes por un límite en memoria por origen. El log lleva el
 * motivo y los NOMBRES de todas las cabeceras recibidas (ordenados), nunca sus valores: sirven para diagnosticar qué cabecera trae el host.
 */
async function tenantDelHost(e: Entorno, req: PeticionHttp, cfg: ConfigRouter): Promise<string | RespuestaApi> {
  const host = hostDePeticion(req.cabeceras);
  let motivo = 'host-invalido';
  if (host !== undefined) {
    if (!e.tenantDelHost.enCache(host)) {
      const limitado = await excedeLimite(cfg.limiteMemoria.hosts, `hosts:${req.origen}`, e.ahora());
      if (limitado !== undefined) return limitado;
      // Tope global de la instancia: rotar el origen no evita la cuota de lecturas de Firestore.
      const global = await excedeLimite(cfg.limiteMemoria.hostsGlobal, 'hosts:*', e.ahora());
      if (global !== undefined) return global;
    }
    const tenantId = await e.tenantDelHost(host);
    if (tenantId !== undefined) return tenantId;
    motivo = 'host-sin-mapeo';
  }
  const presentes = Object.keys(req.cabeceras).sort();
  logger.warn('ruta HTTP rechazada', { motivo, ruta: req.ruta, cabeceras: presentes });
  return json(404, { error: 'no_encontrado' });
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
  // Rutas de tenant por host: el dueño se controla aquí, antes del manejador (el tenant no sale de una credencial).
  if (RUTAS_SITIO.has(ruta)) {
    const tenantId = await tenantDelHost(e, req, cfg);
    if (typeof tenantId !== 'string') return tenantId;
    if (!(await servir(e, ruta, tenantId))) return json(404, { error: 'no_encontrado' });
    return manejarSitioPublico(e, req, ruta, cfg, tenantId);
  }
  // Rutas con tenant de credencial: el manejador llama a `puedeServir` DESPUÉS de autenticar y ANTES de leer datos.
  const puedeServir = (tenantId: string): Promise<boolean> => servir(e, ruta, tenantId);
  switch (ruta) {
    case '/api/novuchat/v1/catalogo':
      return manejarCatalogo(e, peticion, cfg.novuchat, puedeServir);
    case '/api/novuchat/v1/inventario':
      return manejarInventario(e, peticion, cfg.novuchat, puedeServir);
    case '/api/novuchat/v1/pedidos/confirmar':
    {
      // Tenant por host (la firma es un secreto compartido: no se mapea el host de un segundo tenant con inventarios hasta el PR D).
      // El control corre dentro del manejador, tras verificar la firma (D2 = A: 401 credencial_invalida).
      const tenantId = await tenantDelHost(e, req, cfg);
      if (typeof tenantId !== 'string') return tenantId;
      return manejarPedido(e, peticion, cfg.novuchat, tenantId, () => puedeServir(tenantId));
    }
    default:
      if (ruta.startsWith('/api/sitio/v1/')) return manejarSitio(e, peticion, cfg.secretoReconstruccion, puedeServir);
      return json(404, { error: 'no_encontrado' });
  }
}
