// Lector de los módulos efectivos de un tenant (L2-6): lee `tenants/{t}` con Admin SDK y aplica `modulosEfectivos`
// del núcleo sobre los manifiestos del registro. Cache por instancia de 60 s: apagar un módulo tarda hasta 60 s en
// notarse en una instancia ya caliente. Falla cerrado: sin documento, con documento inválido o con id inválido
// devuelve `undefined` y quien llama rechaza. Los positivos se cachean 60 s y los negativos 10 s (LOW-1 de seguridad:
// un token de otro tenant o un id inventado no debe costar una lectura por petición); un alta tarda hasta 10 s en notarse.
import { esTenantIdValido, modulosEfectivos, validarTenant, type IdModulo, type ManifiestoModulo } from '@novutienda/nucleo';
import { registroPlataforma } from '../registro.js';

export const TTL_MODULOS_MS = 60_000;
/** Los resultados negativos (sin documento o inválido) se guardan poco: frenan el martilleo sin demorar un alta. */
export const TTL_NEGATIVO_MS = 10_000;

/** Lo mínimo de Firestore que se necesita (lectura de un documento). */
export interface LectorDocumento {
  doc(ruta: string): { get(): Promise<{ exists: boolean; data(): unknown }> };
}

export type LectorModulos = (tenantId: string) => Promise<readonly IdModulo[] | undefined>;

export function crearLectorModulos(
  firestore: LectorDocumento,
  ahora: () => number,
  manifiestos: () => readonly ManifiestoModulo[] = () => registroPlataforma.listar(),
): LectorModulos {
  const cache = new Map<string, { readonly hasta: number; readonly modulos: readonly IdModulo[] | undefined }>();
  return async (tenantId) => {
    if (!esTenantIdValido(tenantId)) return undefined;
    const t = ahora();
    const previo = cache.get(tenantId);
    if (previo !== undefined && previo.hasta > t) return previo.modulos;
    const snap = await firestore.doc(`tenants/${tenantId}`).get();
    const v = snap.exists ? validarTenant(snap.data()) : undefined;
    if (v === undefined || !v.ok) {
      cache.set(tenantId, { hasta: t + TTL_NEGATIVO_MS, modulos: undefined });
      return undefined;
    }
    const modulos = modulosEfectivos(manifiestos(), Object.keys(v.valor.modulos));
    cache.set(tenantId, { hasta: t + TTL_MODULOS_MS, modulos });
    return modulos;
  };
}
