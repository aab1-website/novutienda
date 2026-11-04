// `DisparadorSitio` de la consola. La reconstrucción real del sitio estático corre en CI (otra ola): aquí solo
// se ENCOLA el trabajo en `tenants/{t}/reconstrucciones/{id}` y GitHub Actions lo lee por el endpoint firmado
// (ver docs/produccion/reconstruccion-sitio.md). Nada depende de ninguna máquina de usuario.
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import type { DisparadorSitio } from '@plataforma/consola';

const YA_EXISTE = 6;

export type EstadoReconstruccion = 'programada' | 'pendiente' | 'en_curso' | 'completada' | 'fallida';

async function crearUnaVez(firestore: Firestore, ruta: string, datos: Record<string, unknown>): Promise<void> {
  try {
    await firestore.doc(ruta).create({ ...datos, creadaEnServidor: FieldValue.serverTimestamp() });
  } catch (error) {
    if ((error as { code?: unknown }).code !== YA_EXISTE) throw error;
  }
}

export function crearDisparadorSitio(firestore: Firestore, ahora: () => number): DisparadorSitio {
  return {
    // Idempotente por (tenant, para): el id contiene el instante programado.
    programar: (tenantId, para) =>
      crearUnaVez(firestore, `tenants/${tenantId}/reconstrucciones/prog-${String(para)}`, { estado: 'programada' satisfies EstadoReconstruccion, para }),

    // Idempotente por (tenant, motivo, versión, minuto): un doble disparo en el mismo minuto es el mismo trabajo.
    reconstruir: (tenantId, version, motivo) => {
      const minuto = new Date(ahora()).toISOString().slice(0, 16).replace(/[-:T]/g, '');
      return crearUnaVez(firestore, `tenants/${tenantId}/reconstrucciones/rec-${motivo}-v${String(version)}-${minuto}`, {
        estado: 'pendiente' satisfies EstadoReconstruccion, version, motivo, solicitadaEnMs: ahora(),
      });
    },
  };
}
