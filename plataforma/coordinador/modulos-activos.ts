// Lector de los módulos efectivos de un tenant (L2-6): lee `tenants/{t}` con Admin SDK y aplica `modulosEfectivos`
// del núcleo sobre los manifiestos del registro. Cache por instancia de 60 s: apagar un módulo tarda hasta 60 s en
// notarse en una instancia ya caliente. Falla cerrado: sin documento, con documento inválido o con id inválido
// devuelve `undefined` y quien llama rechaza. Solo se cachean los resultados positivos (un tenant recién creado
// no queda rechazado 60 s).
import { esTenantIdValido, modulosEfectivos, validarTenant, type IdModulo, type ManifiestoModulo } from '@novutienda/nucleo';
import { registroPlataforma } from '../registro.js';

export const TTL_MODULOS_MS = 60_000;

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
  const cache = new Map<string, { readonly hasta: number; readonly modulos: readonly IdModulo[] }>();
  return async (tenantId) => {
    if (!esTenantIdValido(tenantId)) return undefined;
    const t = ahora();
    const previo = cache.get(tenantId);
    if (previo !== undefined && previo.hasta > t) return previo.modulos;
    const snap = await firestore.doc(`tenants/${tenantId}`).get();
    if (!snap.exists) return undefined;
    const v = validarTenant(snap.data());
    if (!v.ok) return undefined;
    const modulos = modulosEfectivos(manifiestos(), Object.keys(v.valor.modulos));
    cache.set(tenantId, { hasta: t + TTL_MODULOS_MS, modulos });
    return modulos;
  };
}
