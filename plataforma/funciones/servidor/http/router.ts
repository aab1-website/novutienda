// Enrutador de la función HTTP `api`: rutas públicas del sitio, API de NovuChat y endpoints de reconstrucción.
// Función pura sobre `PeticionHttp`; la Cloud Function solo traduce Express a esta forma y de vuelta.
import {
  despacharApi, lectorCotizacion, type DepsContacto, type VerificadorAppCheck, type VerificadorRecaptcha, type LimiteTasa,
} from '@novutienda/website';
import type { Entorno } from '../entorno.js';
import { manejarCatalogo, manejarInventario, manejarPedido, type ConfigNovuchat } from './novuchat.js';
import { manejarSitio } from './sitio.js';
import { json, type PeticionHttp, type RespuestaApi } from './tipos.js';

export interface ConfigRouter {
  readonly tenantId: string;
  readonly novuchat: ConfigNovuchat;
  readonly secretoReconstruccion: string;
  readonly limiteContacto: LimiteTasa;
  /** Límites en memoria por instancia y por origen, ANTES de autenticar (NovuChat) o de leer (disponibilidad). */
  readonly limiteMemoria: { readonly novuchat: LimiteTasa; readonly disponibilidad: LimiteTasa };
  readonly recaptcha: VerificadorRecaptcha;
  readonly appCheck: VerificadorAppCheck;
}

const RUTAS_SITIO = new Set(['/api/cotizacion', '/api/disponibilidad', '/api/contacto']);

async function excedeLimite(limite: LimiteTasa, clave: string, ahora: number): Promise<RespuestaApi | undefined> {
  const r = await limite.intentar(clave, ahora);
  return r.permitido ? undefined : json(429, { error: 'limite' }, { 'Retry-After': String(r.reintentarEnSeg) });
}

export async function enrutar(e: Entorno, req: PeticionHttp, cfg: ConfigRouter): Promise<RespuestaApi> {
  const ruta = req.ruta.length > 1 ? req.ruta.replace(/\/+$/, '') : req.ruta;
  const peticion = { ...req, ruta };
  // Sonda de salud (la usa el despliegue): responde sin tocar ninguna dependencia.
  if (ruta === '/healthz') return { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, cuerpo: 'ok' };
  if (ruta === '/api/disponibilidad') {
    const limitado = await excedeLimite(cfg.limiteMemoria.disponibilidad, `disponibilidad:${req.origen}`, e.ahora());
    if (limitado !== undefined) return limitado;
  } else if (ruta.startsWith('/api/novuchat/')) {
    // Antes de autenticar: un token inventado ya cuesta una lectura de Firestore.
    const limitado = await excedeLimite(cfg.limiteMemoria.novuchat, `novuchat:${req.origen}`, e.ahora());
    if (limitado !== undefined) return limitado;
  }
  if (RUTAS_SITIO.has(ruta)) {
    const contacto: DepsContacto = {
      recaptcha: cfg.recaptcha, appCheck: cfg.appCheck, limite: cfg.limiteContacto, almacen: e.guardarContacto(cfg.tenantId), ahora: e.ahora,
    };
    const r = await despacharApi(
      { metodo: req.metodo, ruta, consulta: req.consulta, cabeceras: req.cabeceras, cuerpo: req.cuerpo, origen: req.origen },
      { leerCotizacion: lectorCotizacion(e.almacenCotizaciones, cfg.tenantId, e.ahora), leerDisponibilidad: e.leerDisponibilidad(cfg.tenantId), contacto },
    );
    return { status: r.status, headers: r.headers, cuerpo: r.cuerpo };
  }
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
