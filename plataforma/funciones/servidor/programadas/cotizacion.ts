// Trabajo programado de la cotización del tipo de cambio (plano §5.3). Es una función pura sobre el `Entorno`; la Cloud
// Function solo la invoca. Nada depende de ninguna máquina de usuario (Cloud Scheduler en la nube del proyecto).
//
// Zona: coordinador, no núcleo (T1, 05/11/2026). `ejecutarCotizaciones` recorre los tenants con el `Entorno` completo,
// corre el núcleo (`actualizarMercado`) y a las 07:00 dispara la reconstrucción diaria del sitio (módulo consola): por
// la prueba de ubicación coordina dos zonas. El núcleo puro de la cotización vive en `paquetes/nucleo/src/tipo-cambio`.
import { logger } from 'firebase-functions';
import { actualizarMercadoDe, mercadosDe, tieneTipoCambio, type ConfiguracionComercial, type OpcionesDescarga } from '@novutienda/nucleo';
import type { Entorno } from '../entorno.js';
import { crearNotificador } from '../notificador.js';
import { ejecutarReconstruccion } from './consola.js';
import { listarTenants, moduloEncendido } from './tenants.js';

/** Hora (0 a 23) en La Paz de un instante. */
export function horaEnLaPaz(ms: number): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/La_Paz', hour: '2-digit', hourCycle: 'h23' }).format(new Date(ms)));
}

export interface ResumenCotizacion {
  readonly tenantId: string;
  readonly mercado: string;
  readonly accion: string;
  readonly fallas: number;
}

async function comercialOUndefined(e: Entorno, tenantId: string): Promise<ConfiguracionComercial | undefined> {
  try {
    return await e.comercialDelTenant(tenantId);
  } catch (err) {
    logger.error('cotización: el tenant no tiene configuración comercial válida', { alerta: 'cotizacion', tipo: 'comercial_invalida', tenantId, error: err instanceof Error ? err.name : 'desconocido' });
    return undefined;
  }
}

/**
 * Actualiza, para cada tenant, SOLO los mercados con tipo de cambio de SU configuración comercial: un tenant sin ninguno no
 * consulta ninguna fuente. Un mercado que falla no impide el otro y un tenant que falla no detiene a los demás; si algo lanza,
 * se registra y se relanza al final para que la ejecución figure como fallida (y el aviso al operador no se pierda). Un tenant
 * sin configuración comercial válida se registra como error (`comercial_invalida`) y se salta: sin configuración no hay mercados
 * que cotizar (falla cerrado), igual que un tenant sin módulos no corre la reconstrucción.
 */
export async function ejecutarCotizaciones(e: Entorno, descarga: OpcionesDescarga = {}): Promise<ResumenCotizacion[]> {
  const resumen: ResumenCotizacion[] = [];
  let error: unknown;
  for (const tenantId of await listarTenants(e)) {
    const notificador = crearNotificador(e.firestore, tenantId, e.ahora);
    const comercial = await comercialOUndefined(e, tenantId);
    const mercados = comercial === undefined ? [] : mercadosDe(comercial).filter((m) => tieneTipoCambio(comercial, m));
    for (const mercado of mercados) {
      try {
        const r = await actualizarMercadoDe(e.almacenCotizaciones, mercado, e.ahora(), { ...descarga, tenantId, notificador, comercial: comercial as ConfiguracionComercial });
        resumen.push({ tenantId, mercado, accion: r.decision.accion, fallas: r.fallas.length });
      } catch (err) {
        error ??= err;
        logger.error('falló la actualización de la cotización', { alerta: 'cotizacion', tipo: 'corrida_fallida', tenantId, mercado, error: err instanceof Error ? err.name : 'desconocido' });
      }
    }
    // La corrida diaria del sitio va tras la primera cotización de la mañana (después de la publicación del BCB).
    if (horaEnLaPaz(e.ahora()) === 7) {
      try {
        // Solo los tenants con consola encendida (L2-6); la cotización de arriba es del núcleo y corre para todos.
        if (!(await moduloEncendido(e, tenantId, 'consola'))) continue;
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
