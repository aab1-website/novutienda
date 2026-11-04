import type { Resultado } from '../contratos/claim.js';
import { esPlanId, type PlanId } from '../limites/planes.js';

export type Moneda = 'BOB' | 'USD' | 'ARS';

export interface ModuloTenant {
  readonly version: string;
  readonly submodulos: readonly string[];
}

/** Documento `tenants/{t}`. */
export interface Tenant {
  readonly plan: PlanId;
  readonly modulos: { readonly [idModulo: string]: ModuloTenant };
  readonly zonaHoraria: 'America/La_Paz';
  readonly monedas: readonly Moneda[];
}

export const ZONA_HORARIA = 'America/La_Paz';
export const MONEDAS: readonly Moneda[] = ['BOB', 'USD', 'ARS'];

const SEMVER = /^\d+\.\d+\.\d+$/;
const TENANT_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

const esObjeto = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/** Un tenantId válido no contiene `/` ni caracteres que alteren una ruta. */
export const esTenantIdValido = (x: unknown): x is string => typeof x === 'string' && TENANT_ID.test(x);

/** Valida el documento `tenants/{t}` leído de la base de datos. */
export function validarTenant(x: unknown): Resultado<Tenant> {
  if (!esObjeto(x)) return { ok: false, error: 'El tenant debe ser un objeto' };
  if (!esPlanId(x['plan'])) return { ok: false, error: 'Plan desconocido' };
  if (x['zonaHoraria'] !== ZONA_HORARIA) return { ok: false, error: `zonaHoraria debe ser ${ZONA_HORARIA}` };
  const monedas = x['monedas'];
  if (
    !Array.isArray(monedas) ||
    monedas.length !== MONEDAS.length ||
    !MONEDAS.every((m) => monedas.includes(m))
  ) {
    return { ok: false, error: 'monedas debe ser BOB, USD y ARS' };
  }
  const modulos = x['modulos'];
  if (!esObjeto(modulos)) return { ok: false, error: 'modulos debe ser un objeto' };
  for (const [id, m] of Object.entries(modulos)) {
    if (id === '') return { ok: false, error: 'Id de módulo vacío' };
    if (!esObjeto(m)) return { ok: false, error: `Módulo ${id} inválido` };
    if (typeof m['version'] !== 'string' || !SEMVER.test(m['version'])) {
      return { ok: false, error: `Versión inválida en el módulo ${id}` };
    }
    const sub = m['submodulos'];
    if (!Array.isArray(sub) || !sub.every((s) => typeof s === 'string' && s !== '')) {
      return { ok: false, error: `Submódulos inválidos en el módulo ${id}` };
    }
  }
  return { ok: true, valor: x as unknown as Tenant };
}
