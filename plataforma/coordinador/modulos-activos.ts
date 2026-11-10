// Lector de los módulos efectivos de un tenant (L2-6): lee `tenants/{t}` con Admin SDK y aplica `modulosEfectivos`
// del núcleo sobre los manifiestos del registro. Cache por instancia de 60 s: apagar un módulo tarda hasta 60 s en
// notarse en una instancia ya caliente. Falla cerrado: sin documento, con documento inválido o con id inválido
// devuelve `undefined` y quien llama rechaza. Los positivos se cachean 60 s y los negativos 10 s (LOW-1 de seguridad:
// un token de otro tenant o un id inventado no debe costar una lectura por petición); un alta tarda hasta 10 s en notarse.
import { esTenantIdValido, modulosEfectivos, tenantOperativo, validarTenant, type IdModulo, type ManifiestoModulo } from '@novutienda/nucleo';
import { registroPlataforma } from '../registro.js';

export const TTL_MODULOS_MS = 60_000;
/** Los resultados negativos (sin documento o inválido) se guardan poco: frenan el martilleo sin demorar un alta. */
export const TTL_NEGATIVO_MS = 10_000;

/** Lo mínimo de Firestore que se necesita (lectura de un documento). */
export interface LectorDocumento {
  doc(ruta: string): { get(): Promise<{ exists: boolean; data(): unknown }> };
}

export type LectorModulos = (tenantId: string) => Promise<readonly IdModulo[] | undefined>;

/** Por qué un tenant no tiene módulos activos: sin documento, inválido o id inválido (`inexistente`/`invalido`), o su estado. */
export type MotivoSinModulos = 'inexistente' | 'invalido' | 'suspendido' | 'baja';
export type ResultadoModulos = { readonly modulos: readonly IdModulo[] } | { readonly motivo: MotivoSinModulos; readonly modulosSiOpera?: readonly IdModulo[] };
export type LectorEstadoModulos = (tenantId: string) => Promise<ResultadoModulos>;

/** Un solo cache compartido: `modulos` (undefined si no opera, como siempre) y `estado` (con el motivo). */
export function crearLectoresModulos(
  firestore: LectorDocumento,
  ahora: () => number,
  manifiestos: () => readonly ManifiestoModulo[] = () => registroPlataforma.listar(),
): { readonly modulos: LectorModulos; readonly estado: LectorEstadoModulos } {
  const cache = new Map<string, { readonly hasta: number; readonly r: ResultadoModulos }>();
  const estado: LectorEstadoModulos = async (tenantId) => {
    if (!esTenantIdValido(tenantId)) return { motivo: 'invalido' };
    const t = ahora();
    const previo = cache.get(tenantId);
    if (previo !== undefined && previo.hasta > t) return previo.r;
    const snap = await firestore.doc(`tenants/${tenantId}`).get();
    const v = snap.exists ? validarTenant(snap.data()) : undefined;
    // Un tenant suspendido o dado de baja no opera: se trata como inexistente (falla cerrado, cache negativa).
    if (v === undefined || !v.ok || !tenantOperativo(v.valor)) {
      const motivo: MotivoSinModulos = v === undefined ? 'inexistente' : !v.ok ? 'invalido' : v.valor.estado === 'suspendido' ? 'suspendido' : 'baja';
      // Solo el suspendido expone sus módulos efectivos (para el propietario); `modulos` sigue dando undefined.
      const r: ResultadoModulos = v !== undefined && v.ok && motivo === 'suspendido' ? { motivo, modulosSiOpera: modulosEfectivos(manifiestos(), Object.keys(v.valor.modulos)) } : { motivo };
      cache.set(tenantId, { hasta: t + TTL_NEGATIVO_MS, r });
      return r;
    }
    const r: ResultadoModulos = { modulos: modulosEfectivos(manifiestos(), Object.keys(v.valor.modulos)) };
    cache.set(tenantId, { hasta: t + TTL_MODULOS_MS, r });
    return r;
  };
  return { estado, modulos: async (tenantId) => { const r = await estado(tenantId); return 'modulos' in r ? r.modulos : undefined; } };
}

export function crearLectorModulos(
  firestore: LectorDocumento,
  ahora: () => number,
  manifiestos: () => readonly ManifiestoModulo[] = () => registroPlataforma.listar(),
): LectorModulos {
  return crearLectoresModulos(firestore, ahora, manifiestos).modulos;
}
