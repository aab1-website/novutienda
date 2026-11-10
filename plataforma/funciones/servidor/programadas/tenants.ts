// Recorrido de tenants para los trabajos programados (coordinador, plano §5.3 y enmienda H0): enumera los tenants
// existentes y corre el trabajo de cada zona por cada uno sin que un tenant roto detenga a los demás. No sabe qué
// hace cada trabajo; eso lo ponen `cotizacion.ts` (núcleo + consola) y `consola.ts` (módulo).
import { logger } from 'firebase-functions';
import { esTenantIdValido, tenantOperativo } from '@novutienda/nucleo';
import type { Entorno } from '../entorno.js';

/**
 * Tenants activos (`tenants/{t}` con documento y `estado: 'activo'`) y de id válido. `listDocuments` también devuelve los «fantasmas»
 * (rutas que solo tienen subcolecciones), por eso se confirma que el documento exista.
 */
export async function listarTenants(e: Entorno): Promise<string[]> {
  const refs = (await e.firestore.collection('tenants').listDocuments()).filter((r) => esTenantIdValido(r.id));
  if (refs.length === 0) return [];
  const docs = await e.firestore.getAll(...refs, { fieldMask: ['estado'] });
  return docs.filter((d) => d.exists && tenantOperativo({ estado: d.get('estado') })).map((d) => d.id).sort();
}

/** `true` si el módulo está entre los efectivos del tenant. Falla cerrado: tenant sin documento o inválido → `false`. */
export async function moduloEncendido(e: Entorno, tenantId: string, modulo: string): Promise<boolean> {
  return (await e.modulosDelTenant(tenantId))?.includes(modulo) === true;
}

export interface OpcionesPorTenant {
  /** Si se indica, los tenants con ese módulo apagado se saltan (no aparecen en la salida). */
  readonly modulo?: string;
}

/**
 * Corre `fn` por cada tenant sin que uno roto detenga a los demás; si alguno falló, relanza el primer error al final.
 * Con `{ modulo }` salta los tenants que no lo tienen encendido (L2-6).
 */
export async function porTenant<T>(
  e: Entorno,
  nombre: string,
  fn: (tenantId: string) => Promise<T>,
  opciones: OpcionesPorTenant = {},
): Promise<Record<string, T>> {
  const salida: Record<string, T> = {};
  let error: unknown;
  for (const tenantId of await listarTenants(e)) {
    try {
      if (opciones.modulo !== undefined && !(await moduloEncendido(e, tenantId, opciones.modulo))) continue;
      salida[tenantId] = await fn(tenantId);
    } catch (err) {
      error ??= err;
      logger.error(`falló el trabajo programado: ${nombre}`, { tenantId, error: err instanceof Error ? err.name : 'desconocido' });
    }
  }
  if (error !== undefined) throw error;
  return salida;
}
