// Trabajos programados: cotización del tipo de cambio, limpieza de subidas vencidas y reconstrucción del sitio.
// Cada uno es una función pura sobre el `Entorno`; las Cloud Functions solo los invocan. Nada depende de ninguna
// máquina de usuario (Cloud Scheduler en la nube del proyecto).
import { logger } from 'firebase-functions';
import { ejecutarReconstruccion, limpiarSubidas } from '@novutienda/consola';
import { actualizarMercado, esTenantIdValido, type Mercado, type OpcionesDescarga } from '@novutienda/nucleo';
import type { Entorno } from './entorno.js';
import { depsMedios } from './llamadas/medios.js';
import { crearNotificador } from './notificador.js';

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
async function porTenant<T>(e: Entorno, nombre: string, fn: (tenantId: string) => Promise<T>): Promise<Record<string, T>> {
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

/** Hora (0 a 23) en La Paz de un instante. */
export function horaEnLaPaz(ms: number): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/La_Paz', hour: '2-digit', hourCycle: 'h23' }).format(new Date(ms)));
}

export interface ResumenCotizacion {
  readonly tenantId: string;
  readonly mercado: Mercado;
  readonly accion: string;
  readonly fallas: number;
}

/**
 * Actualiza BO y AR para cada tenant. Un mercado que falla no impide el otro; si algo lanza, se registra y se
 * relanza al final para que la ejecución figure como fallida (y el aviso al operador no se pierda).
 */
export async function ejecutarCotizaciones(e: Entorno, descarga: OpcionesDescarga = {}): Promise<ResumenCotizacion[]> {
  const resumen: ResumenCotizacion[] = [];
  let error: unknown;
  for (const tenantId of await listarTenants(e)) {
    const notificador = crearNotificador(e.firestore, tenantId, e.ahora);
    for (const mercado of ['BO', 'AR'] as const) {
      try {
        const r = await actualizarMercado(e.almacenCotizaciones, mercado, e.ahora(), { ...descarga, tenantId, notificador });
        resumen.push({ tenantId, mercado, accion: r.decision.accion, fallas: r.fallas.length });
      } catch (err) {
        error ??= err;
        logger.error('falló la actualización de la cotización', { alerta: 'cotizacion', tipo: 'corrida_fallida', tenantId, mercado, error: err instanceof Error ? err.name : 'desconocido' });
      }
    }
    // La corrida diaria del sitio va tras la primera cotización de la mañana (después de la publicación del BCB).
    if (horaEnLaPaz(e.ahora()) === 7) {
      try {
        await ejecutarReconstruccion({ db: e.db, reloj: { ahora: e.ahora }, disparador: e.disparadorSitio }, { tenantId, evento: 'diaria' });
      } catch (err) {
        error ??= err;
        logger.error('falló la reconstrucción diaria', { tenantId, error: err instanceof Error ? err.name : 'desconocido' });
      }
    }
  }
  if (error !== undefined) throw error;
  return resumen;
}

/** Libera las reservas de subida vencidas y reintenta los borrados pendientes. */
export function ejecutarLimpiezaSubidas(e: Entorno): Promise<Record<string, { vencidas: number; reintentadas: number }>> {
  return porTenant(e, 'limpieza de subidas', (tenantId) => limpiarSubidas({ ...depsMedios({ e }), consulta: e.consultaSubidas }, tenantId));
}

/** Temporizador de la reconstrucción del sitio: encola la agendada para esta hora (agrupa 10 minutos de cambios). */
export function ejecutarTemporizadorSitio(e: Entorno): Promise<Record<string, string>> {
  return porTenant(e, 'temporizador del sitio', async (tenantId) =>
    (await ejecutarReconstruccion({ db: e.db, reloj: { ahora: e.ahora }, disparador: e.disparadorSitio }, { tenantId, evento: 'temporizador' })).accion,
  );
}
