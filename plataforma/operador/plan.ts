// Asignación del plan de un tenant (`base` o `pruebas`). Lo ejecuta solo el operador.
// Lógica pura: la base llega por inyección; aquí no hay red. Los mensajes no llevan identificadores ni datos personales.
import { PLANES, esPlanId, esTenantIdValido, registrarAuditoria } from '@novutienda/nucleo';
import type { TransaccionAuditoria } from '@novutienda/nucleo';
import { operadorDe } from './personal.js';

/** Planes que este script asigna. `multimercado` y otros se dan de alta por otra vía. */
export const PLANES_ASIGNABLES = ['base', 'pruebas'] as const;
export type PlanAsignable = (typeof PLANES_ASIGNABLES)[number];

export interface TransaccionPlan extends TransaccionAuditoria {
  get(ruta: string): Promise<{ readonly existe: boolean; data(): Readonly<Record<string, unknown>> | undefined }>;
  update(ruta: string, datos: Readonly<Record<string, unknown>>): void;
}
export interface BaseDatosPlan {
  runTransaction<T>(fn: (tx: TransaccionPlan) => Promise<T>): Promise<T>;
}
export interface ResultadoPlan {
  readonly de: string;
  readonly a: PlanAsignable;
  readonly aplicado: boolean;
  readonly diferencias: readonly string[];
}

/**
 * Asigna `plan` a `tenants/{t}`. Sin `aplicar` solo informa. El plan `pruebas` solo se asigna en staging o emulador
 * (`ambiente`); en cualquier otro valor se rechaza, aunque la guardia de entorno del script ya lo impide.
 * Con `aplicar` escribe el plan y audita (`tenant.plan`) en la misma transacción. Si ya tiene ese plan no escribe.
 */
export async function asignarPlan(o: {
  readonly tenantId: string;
  readonly plan: string;
  readonly ambiente: string;
  readonly db: BaseDatosPlan;
  readonly operador: string;
  readonly aplicar: boolean;
}): Promise<ResultadoPlan> {
  if (!esTenantIdValido(o.tenantId)) throw new Error('el tenant no es un identificador válido');
  if (!(PLANES_ASIGNABLES as readonly string[]).includes(o.plan) || !esPlanId(o.plan)) throw new Error('plan no asignable: use base o pruebas');
  const a = o.plan as PlanAsignable;
  if (a === 'pruebas' && o.ambiente !== 'staging' && o.ambiente !== 'emulador') throw new Error('el plan pruebas solo se asigna en staging');
  const operador = operadorDe(o.operador);
  const ruta = `tenants/${o.tenantId}`;
  const leer = async (tx: TransaccionPlan): Promise<string> => {
    const doc = await tx.get(ruta);
    if (!doc.existe) throw new Error('el tenant no existe');
    const plan = doc.data()?.['plan'];
    if (typeof plan !== 'string' || !esPlanId(plan)) throw new Error('el tenant no tiene un plan válido: corra el alta antes');
    return plan;
  };
  // Misma transacción: el plan y, al bajar de `pruebas` a `base`, el contador de usuarios (aviso sin identificadores).
  const { de, usuarios } = await o.db.runTransaction(async (tx) => {
    const plan = await leer(tx);
    if (plan !== 'pruebas' || a !== 'base') return { de: plan, usuarios: undefined };
    const n = (await tx.get(`${ruta}/contadores/uso`)).data()?.['usuarios'];
    return { de: plan, usuarios: typeof n === 'number' ? n : undefined };
  });
  if (de === a) return { de, a, aplicado: false, diferencias: [] };
  const diferencias = [`plan: ${de} -> ${a}`];
  if (usuarios !== undefined && usuarios > PLANES[a].usuarios) {
    diferencias.push(`aviso: usuarios actuales ${usuarios} > tope ${PLANES[a].usuarios}`);
  }
  if (!o.aplicar) return { de, a, aplicado: false, diferencias };
  await o.db.runTransaction(async (tx) => {
    if ((await leer(tx)) !== de) throw new Error('el plan cambió durante la operación: reintente');
    tx.update(ruta, { plan: a });
    registrarAuditoria(tx, {
      tenantId: o.tenantId,
      uid: operador,
      rol: 'adm', // valor admitido por el núcleo; quién actuó lo dice `uid` (`operador:<cuenta>`)
      motivo: 'operador de plataforma',
      accion: 'tenant.plan',
      ruta,
      resumenAntes: { plan: de },
      resumenDespues: { plan: a },
    });
  });
  return { de, a, aplicado: true, diferencias };
}
