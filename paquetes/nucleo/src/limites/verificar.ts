import { esTenantIdValido, validarTenant } from '../tenant/tenant.js';
import { PLANES, type ClaveLimite } from './planes.js';
import type { TransaccionMin } from './transaccion.js';

/** Se lanza cuando una alta supera el tope del plan. */
export class LimiteDelPlan extends Error {
  constructor(
    readonly clave: ClaveLimite,
    readonly tope: number,
  ) {
    super(`Límite del plan alcanzado: ${clave} (máximo ${tope})`);
    this.name = 'LimiteDelPlan';
  }
}

/** Se lanza cuando un contador guardado no es un entero no negativo. Nunca se interpreta como cero. */
export class ContadorCorrupto extends Error {
  constructor(
    readonly clave: ClaveLimite,
    readonly valor: unknown,
  ) {
    super(`Contador corrupto: ${clave} no es un entero no negativo`);
    this.name = 'ContadorCorrupto';
  }
}

export const rutaContador = (tenantId: string): string => `tenants/${tenantId}/contadores/uso`;

/** Lee el contador: ausente vale 0; presente pero inválido (negativo, texto, decimal) lanza. */
function leerUso(datos: Readonly<Record<string, unknown>>, clave: ClaveLimite): number {
  if (!Object.hasOwn(datos, clave)) return 0;
  const usado = datos[clave];
  if (typeof usado !== 'number' || !Number.isSafeInteger(usado) || usado < 0) {
    throw new ContadorCorrupto(clave, usado);
  }
  return usado;
}

/**
 * Verifica el tope del plan y reserva una unidad, dentro de la transacción
 * recibida. Lanza `LimiteDelPlan` si el contador ya alcanzó el tope y
 * `ContadorCorrupto` si el contador guardado es inválido; la transacción debe
 * abortarse con ese error.
 */
export async function verificarYReservar(
  tx: TransaccionMin,
  tenantId: string,
  clave: ClaveLimite,
): Promise<number> {
  if (!esTenantIdValido(tenantId)) throw new Error('tenantId inválido');
  const doc = await tx.get(`tenants/${tenantId}`);
  const tenant = validarTenant(doc.data());
  if (!doc.existe || !tenant.ok) throw new Error('Tenant inexistente o inválido');
  const tope = PLANES[tenant.valor.plan][clave];
  const ruta = rutaContador(tenantId);
  const actual = await tx.get(ruta);
  const datos = actual.data() ?? {};
  const n = leerUso(datos, clave);
  if (n >= tope) throw new LimiteDelPlan(clave, tope);
  tx.set(ruta, { ...datos, [clave]: n + 1 });
  return n + 1;
}

/**
 * Libera una unidad del contador (baja de producto, de usuario, cierre de
 * caja). Nunca baja de 0. Lanza `ContadorCorrupto` si el valor guardado es
 * inválido. Devuelve el uso resultante.
 */
export async function liberar(tx: TransaccionMin, tenantId: string, clave: ClaveLimite): Promise<number> {
  if (!esTenantIdValido(tenantId)) throw new Error('tenantId inválido');
  const ruta = rutaContador(tenantId);
  const actual = await tx.get(ruta);
  const datos = actual.data() ?? {};
  const n = leerUso(datos, clave);
  const nuevo = Math.max(0, n - 1);
  if (nuevo !== n || !Object.hasOwn(datos, clave)) tx.set(ruta, { ...datos, [clave]: nuevo });
  return nuevo;
}

/** Abre una caja (inicio de turno): reserva el cupo de cajas activas. Lanza `LimiteDelPlan` si ya hay una activa. */
export const abrirCaja = (tx: TransaccionMin, tenantId: string): Promise<number> =>
  verificarYReservar(tx, tenantId, 'cajas');

/** Cierra una caja (fin de turno): libera el cupo de cajas activas. */
export const cerrarCaja = (tx: TransaccionMin, tenantId: string): Promise<number> => liberar(tx, tenantId, 'cajas');
