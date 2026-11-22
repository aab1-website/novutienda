// `DisparadorSitio` de la consola. La reconstrucción real del sitio estático corre en CI (otra ola): aquí solo
// se ENCOLA el trabajo en `tenants/{t}/reconstrucciones/{id}` y GitHub Actions lo lee por el endpoint firmado
// (ver docs/produccion/reconstruccion-sitio.md). Nada depende de ninguna máquina de usuario.
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import type { ColaSitio, DisparadorSitio } from '@novutienda/consola';

const YA_EXISTE = 6;

export type EstadoReconstruccion = 'programada' | 'pendiente' | 'en_curso' | 'completada' | 'fallida';

async function crearUnaVez(firestore: Firestore, ruta: string, datos: Record<string, unknown>): Promise<void> {
  try {
    await firestore.doc(ruta).create({ ...datos, creadaEnServidor: FieldValue.serverTimestamp() });
  } catch (error) {
    if ((error as { code?: unknown }).code !== YA_EXISTE) throw error;
  }
}

/** Nombre idempotente de la tarea por (tenant, `para`); Cloud Tasks solo admite letras, dígitos, guion y guion bajo. */
export const nombreTareaSitio = (tenantId: string, para: number): string => `sitio-${tenantId}-${String(para)}`.replace(/[^A-Za-z0-9_-]/g, '_');

/**
 * `cola` (opcional): con ella, además del `prog-*` se encola una tarea para `para` (modo `google`). Sin cola, el comportamiento
 * es el de siempre. Si encolar falla, `programar` no falla: el `prog-*` ya está escrito y el temporizador de 5 min es la red.
 */
export function crearDisparadorSitio(firestore: Firestore, ahora: () => number, cola?: ColaSitio): DisparadorSitio {
  return {
    // Idempotente por (tenant, para): el id contiene el instante programado.
    programar: async (tenantId, para) => {
      await crearUnaVez(firestore, `tenants/${tenantId}/reconstrucciones/prog-${String(para)}`, { estado: 'programada' satisfies EstadoReconstruccion, para });
      if (cola === undefined) return;
      try {
        await cola.encolar({ nombre: nombreTareaSitio(tenantId, para), tenantId, para });
      } catch {
        logger.warn('tarea de construcción del sitio no encolada; la recoge el temporizador');
      }
    },

    // Idempotente por (tenant, motivo, versión, minuto): un doble disparo en el mismo minuto es el mismo trabajo.
    reconstruir: (tenantId, version, motivo) => {
      const minuto = new Date(ahora()).toISOString().slice(0, 16).replace(/[-:T]/g, '');
      return crearUnaVez(firestore, `tenants/${tenantId}/reconstrucciones/rec-${motivo}-v${String(version)}-${minuto}`, {
        estado: 'pendiente' satisfies EstadoReconstruccion, version, motivo, solicitadaEnMs: ahora(),
      });
    },
  };
}
