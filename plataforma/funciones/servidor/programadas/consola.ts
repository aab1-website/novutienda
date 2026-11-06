// Trabajos programados del módulo consola (borde en plataforma, plano §5.3): limpieza de subidas vencidas y
// temporizador de la reconstrucción del sitio. Cada uno es una función pura sobre el `Entorno`; las Cloud Functions
// solo los invocan, y el recorrido de tenants lo hace el coordinador (`tenants.ts`). Nada depende de ninguna máquina
// de usuario (Cloud Scheduler en la nube del proyecto).
import { ejecutarReconstruccion, limpiarSubidas } from '@novutienda/consola';
import type { Entorno } from '../entorno.js';
import { depsMedios } from '../llamadas/medios.js';
import { porTenant } from './tenants.js';

// La corrida diaria del sitio (a las 07:00, tras la cotización) la dispara `cotizacion.ts`; este borde expone la función
// del módulo para que el coordinador no importe `@novutienda/consola` fuera de un compositor (regla de zonas).
export { ejecutarReconstruccion };

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
