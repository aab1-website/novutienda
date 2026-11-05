// Recorrido de tenants para los trabajos programados (coordinador, plano §5.3 y enmienda H0): enumera los tenants
// existentes y corre el trabajo de cada zona por cada uno sin que un tenant roto detenga a los demás. No sabe qué
// hace cada trabajo; eso lo ponen `cotizacion.ts` (núcleo + consola) y `consola.ts` (módulo).
import { logger } from 'firebase-functions';
import { esTenantIdValido } from '@novutienda/nucleo';
import type { Entorno } from '../entorno.js';

/**
 * Tenants que existen (`tenants/{t}` con documento) y de id válido. `listDocuments` también devuelve los «fantasmas»
 * (rutas que solo tienen subcolecciones), por eso se confirma que el documento exista.
 */
export async function listarTenants(e: Entorno): Promise<string[]> {
  const refs = (await e.firestore.collection('tenants').listDocuments()).filter((r) => esTenantIdValido(r.id));
  if (refs.length === 0) return [];
  const docs = await e.firestore.getAll(...refs, { fieldMask: ['plan'] });
  return docs.filter((d) => d.exists).map((d) => d.id).sort();
}

/** Corre `fn` por cada tenant sin que uno roto detenga a los demás; si alguno falló, relanza el primer error al final. */
export async function porTenant<T>(e: Entorno, nombre: string, fn: (tenantId: string) => Promise<T>): Promise<Record<string, T>> {
  const salida: Record<string, T> = {};
  let error: unknown;
  for (const tenantId of await listarTenants(e)) {
    try {
      salida[tenantId] = await fn(tenantId);
    } catch (err) {
      error ??= err;
      logger.error(`falló el trabajo programado: ${nombre}`, { tenantId, error: err instanceof Error ? err.name : 'desconocido' });
    }
  }
  if (error !== undefined) throw error;
  return salida;
}
