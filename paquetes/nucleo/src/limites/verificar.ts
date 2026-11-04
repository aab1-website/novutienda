import { esTenantIdValido, validarTenant } from '../tenant/tenant.js';
import type { LimiteColeccion } from '../registro/tipos.js';
import { PLANES } from './planes.js';
import type { TransaccionMin } from './transaccion.js';

/** Se lanza cuando una alta supera el tope del plan. */
export class LimiteDelPlan extends Error {
  constructor(
    readonly clave: LimiteColeccion,
    readonly tope: number,
  ) {
    super(`Límite del plan alcanzado: ${clave} (máximo ${tope})`);
    this.name = 'LimiteDelPlan';
  }
}

export const rutaContador = (tenantId: string): string => `tenants/${tenantId}/contadores/uso`;

/**
 * Verifica el tope del plan y reserva una unidad, dentro de la transacción
 * recibida. Lanza `LimiteDelPlan` si el contador ya alcanzó el tope; la
 * transacción debe abortarse con ese error.
 */
export async function verificarYReservar(
  tx: TransaccionMin,
  tenantId: string,
  clave: LimiteColeccion,
): Promise<number> {
  if (!esTenantIdValido(tenantId)) throw new Error('tenantId inválido');
  const doc = await tx.get(`tenants/${tenantId}`);
  const tenant = validarTenant(doc.data());
  if (!doc.existe || !tenant.ok) throw new Error('Tenant inexistente o inválido');
  const tope = PLANES[tenant.valor.plan][clave];
  const ruta = rutaContador(tenantId);
  const actual = await tx.get(ruta);
  const datos = actual.data() ?? {};
  const usado = datos[clave];
  const n = typeof usado === 'number' && Number.isInteger(usado) && usado >= 0 ? usado : 0;
  if (n >= tope) throw new LimiteDelPlan(clave, tope);
  tx.set(ruta, { ...datos, [clave]: n + 1 });
  return n + 1;
}
