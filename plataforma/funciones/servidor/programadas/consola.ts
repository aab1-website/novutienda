// Trabajos programados del módulo consola (borde en plataforma, plano §5.3): limpieza de subidas vencidas y
// temporizador de la reconstrucción del sitio. Cada uno es una función pura sobre el `Entorno`; las Cloud Functions
// solo los invocan, y el recorrido de tenants lo hace el coordinador (`tenants.ts`). Nada depende de ninguna máquina
// de usuario (Cloud Scheduler en la nube del proyecto).
import { logger } from 'firebase-functions';
import { ejecutarReconstruccion, limpiarSubidas } from '@novutienda/consola';
import type { Entorno } from '../entorno.js';
import { depsMedios } from '../llamadas/medios.js';
import { redConstruccion, type DepsConstruccion } from '../construccion-sitio.js';
import { porTenant } from './tenants.js';

// La corrida diaria del sitio (a las 07:00, tras la cotización) la dispara `cotizacion.ts`; este borde expone la función
// del módulo para que el coordinador no importe `@novutienda/consola` fuera de un compositor (regla de zonas).
export { ejecutarReconstruccion };

/**
 * Libera las reservas de subida vencidas y reintenta los borrados pendientes. Es mantenimiento: corre para todos los
 * tenants, también con consola apagada (D4 = A), para no dejar cuota ni objetos huérfanos.
 */
export function ejecutarLimpiezaSubidas(e: Entorno): Promise<Record<string, { vencidas: number; reintentadas: number }>> {
  return porTenant(e, 'limpieza de subidas', (tenantId) => limpiarSubidas({ ...depsMedios({ e }), consulta: e.consultaSubidas }, tenantId));
}

/**
 * Temporizador de la reconstrucción del sitio: encola la agendada para esta hora (agrupa 60 s de cambios). Si al menos un
 * tenant pasó a `reconstruir` en esta corrida, avisa UNA vez a GitHub (S7-3); si el aviso falla, el temporizador no falla ni
 * reintenta más: el trabajo queda `pendiente` y lo recoge el sondeo. La corrida diaria no avisa (queda con el sondeo).
 *
 * Con `construccion` (modo `google`, lo pasa el coordinador) no se avisa a GitHub: tras la decisión corre la red de seguridad
 * (`redConstruccion`: relanza pendientes sin construcción o con bloqueo vencido, motivo `codigo`, alerta de más de 10 minutos, contador diario).
 * Sin él, todo igual que antes.
 */
export async function ejecutarTemporizadorSitio(e: Entorno, construccion?: DepsConstruccion): Promise<Record<string, string>> {
  let hayReconstruccion = false;
  try {
    return await porTenant(e, 'temporizador del sitio', async (tenantId) => {
      const { accion } = await ejecutarReconstruccion({ db: e.db, reloj: { ahora: e.ahora }, disparador: e.disparadorSitio }, { tenantId, evento: 'temporizador' });
      if (construccion !== undefined) return `${accion}/${await redConstruccion(construccion, tenantId)}`;
      if (accion === 'reconstruir') hayReconstruccion = true;
      return accion;
    }, { modulo: 'consola' });
  } finally {
    // También si otro tenant falló: lo que sí se encoló no debe esperar al sondeo.
    if (hayReconstruccion) await avisarReconstruccion(e);
  }
}

async function avisarReconstruccion(e: Entorno): Promise<void> {
  if (e.disparoSitio === undefined) return;
  try {
    const r = await e.disparoSitio.disparar();
    if (!r.ok) logger.warn(`disparo de reconstrucción no enviado (estado ${String(r.estado)})`);
  } catch {
    logger.warn('disparo de reconstrucción no enviado (estado red)');
  }
}
