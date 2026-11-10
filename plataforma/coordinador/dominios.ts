// Tenant de las rutas públicas (sitio y pedido firmado de NovuChat): sale del HOST de la petición, con lista cerrada
// (`dominios/{host}` = {tenantId}, lo escribe solo el operador). Sin mapeo no hay tenant: quien llama responde 404.
// El host se toma SOLO de `x-forwarded-host` (Hosting lo pone al reescribir a la función); nunca de `host`, que en Cloud Run
// es el de la propia función. Caché por instancia: positivos 60 s y negativos 10 s, con tope de entradas.
import { esTenantIdValido } from '@novutienda/nucleo';
import { esHostValido } from '../operador/dominio.js';
import type { LectorDocumento } from './modulos-activos.js';

export const TTL_DOMINIO_MS = 60_000;
export const TTL_DOMINIO_NEGATIVO_MS = 10_000;
/** Tope de entradas de la caché (un host inventado por petición no debe crecer la memoria sin límite). */
export const TOPE_DOMINIOS = 500;

/**
 * Host de la petición normalizado, o `undefined` si falta o no es válido. Solo `x-forwarded-host`, y solo si trae UN valor
 * (una coma indica una cadena de proxies o una inyección: se rechaza). Minúsculas, sin puerto ni punto final.
 */
export function hostDePeticion(cabeceras: Readonly<Record<string, string | undefined>>): string | undefined {
  const crudo = cabeceras['x-forwarded-host'];
  if (crudo === undefined || crudo.includes(',')) return undefined;
  const host = crudo.trim().toLowerCase().replace(/:\d{1,5}$/, '').replace(/\.$/, '');
  return esHostValido(host) ? host : undefined;
}

/** Tenant del host (`undefined` si no hay mapeo) y si la respuesta ya está en caché (leerla no cuesta una lectura). */
export interface LectorDominios {
  (host: string): Promise<string | undefined>;
  enCache(host: string): boolean;
}

export function crearLectorDominios(firestore: LectorDocumento, ahora: () => number): LectorDominios {
  const cache = new Map<string, { readonly hasta: number; readonly tenantId: string | undefined }>();
  const guardar = (host: string, tenantId: string | undefined, t: number): void => {
    if (!cache.has(host) && cache.size >= TOPE_DOMINIOS) {
      for (const [k, v] of cache) if (v.hasta <= t) cache.delete(k);
      const masAntiguo = cache.keys().next();
      if (cache.size >= TOPE_DOMINIOS && masAntiguo.done !== true) cache.delete(masAntiguo.value);
    }
    cache.set(host, { hasta: t + (tenantId === undefined ? TTL_DOMINIO_NEGATIVO_MS : TTL_DOMINIO_MS), tenantId });
  };
  const leer = async (host: string): Promise<string | undefined> => {
    if (!esHostValido(host)) return undefined; // sin lectura: la ruta de Firestore no se arma con un host inválido
    const t = ahora();
    const previo = cache.get(host);
    if (previo !== undefined && previo.hasta > t) return previo.tenantId;
    const snap = await firestore.doc(`dominios/${host}`).get();
    const id = snap.exists ? (snap.data() as { tenantId?: unknown } | undefined)?.tenantId : undefined;
    const tenantId = typeof id === 'string' && esTenantIdValido(id) ? id : undefined;
    guardar(host, tenantId, t);
    return tenantId;
  };
  return Object.assign(leer, {
    enCache: (host: string): boolean => (cache.get(host)?.hasta ?? 0) > ahora(),
  });
}
