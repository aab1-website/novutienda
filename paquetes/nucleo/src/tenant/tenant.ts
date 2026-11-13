import type { Resultado } from '../contratos/claim.js';
import { esPlanId, validarComercialContraPlan, type PlanId } from '../limites/planes.js';
import { COMERCIAL_LEGADO_TRES_MONEDAS } from '../tipo-cambio/tipos.js';
import { validarConfiguracionComercial, type ConfiguracionComercial } from './mercados.js';

export type Moneda = 'BOB' | 'USD' | 'ARS';

export interface ModuloTenant {
  readonly version: string;
  readonly submodulos: readonly string[];
}

/** Ciclo de vida del tenant. `baja` es terminal: el id no se reutiliza. */
export type EstadoTenant = 'activo' | 'suspendido' | 'baja';
export const ESTADOS_TENANT: readonly EstadoTenant[] = ['activo', 'suspendido', 'baja'];

export const esEstadoTenant = (x: unknown): x is EstadoTenant =>
  typeof x === 'string' && (ESTADOS_TENANT as readonly string[]).includes(x);

/** Solo un tenant activo opera (falla cerrado en cualquier otro estado). */
export const tenantOperativo = (t: Pick<Tenant, 'estado'>): boolean => t.estado === 'activo';

/** Transiciones permitidas; `baja` no sale a ningún estado y no se «transita» a sí mismo. */
export const transicionValida = (de: EstadoTenant, a: EstadoTenant): boolean => de !== 'baja' && de !== a;

/** Documento `tenants/{t}`. */
export interface Tenant {
  readonly estado: EstadoTenant;
  readonly plan: PlanId;
  readonly modulos: { readonly [idModulo: string]: ModuloTenant };
  /** Mercados y monedas que declara el tenant (configuración v3). Ausente solo en el documento LEGADO. */
  readonly comercial?: ConfiguracionComercial;
  /** LEGADO (documento anterior a la v3, sin `comercial`): ver `comercialLegado`. */
  readonly zonaHoraria?: 'America/La_Paz';
  /** LEGADO (documento anterior a la v3, sin `comercial`): ver `comercialLegado`. */
  readonly monedas?: readonly Moneda[];
}

/** @deprecated LEGADO del tenant de tres monedas: usar `zonaDe(comercial, mercado)`. */
export const ZONA_HORARIA = 'America/La_Paz';
/** @deprecated LEGADO del tenant de tres monedas: usar `monedasCaja(comercial)`. */
export const MONEDAS: readonly Moneda[] = ['BOB', 'USD', 'ARS'];

/**
 * LEGADO: el documento anterior a la v3 no declara mercados; solo `zonaHoraria` y `monedas`. Si son exactamente
 * `America/La_Paz` y BOB, USD y ARS, equivale a la declaración explícita del tenant de tres monedas. Cualquier otra
 * combinación es inválida (no se inventan mercados). Se retira cuando el documento se vuelva a dar de alta con
 * `comercial` (PR E).
 * @deprecated LEGADO: el documento v3 declara `comercial`.
 */
export function comercialLegado(x: { readonly zonaHoraria?: unknown; readonly monedas?: unknown }): Resultado<ConfiguracionComercial> {
  if (x.zonaHoraria !== ZONA_HORARIA) return { ok: false, error: `zonaHoraria debe ser ${ZONA_HORARIA}` };
  const monedas = x.monedas;
  if (!Array.isArray(monedas) || monedas.length !== MONEDAS.length || !MONEDAS.every((m) => monedas.includes(m))) {
    return { ok: false, error: 'monedas debe ser BOB, USD y ARS' };
  }
  return { ok: true, valor: COMERCIAL_LEGADO_TRES_MONEDAS };
}

/** La configuración comercial del tenant ya validado: la declarada o, en el documento legado, la derivada. */
export function comercialDe(t: Pick<Tenant, 'comercial' | 'zonaHoraria' | 'monedas'>): Resultado<ConfiguracionComercial> {
  return t.comercial !== undefined ? { ok: true, valor: t.comercial } : comercialLegado(t);
}

const SEMVER = /^\d+\.\d+\.\d+$/;
const TENANT_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

const esObjeto = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/** Un tenantId válido no contiene `/` ni caracteres que alteren una ruta. */
export const esTenantIdValido = (x: unknown): x is string => typeof x === 'string' && TENANT_ID.test(x);

/** Valida el documento `tenants/{t}` leído de la base de datos. */
export function validarTenant(x: unknown): Resultado<Tenant> {
  if (!esObjeto(x)) return { ok: false, error: 'El tenant debe ser un objeto' };
  if (!esEstadoTenant(x['estado'])) return { ok: false, error: 'Estado de tenant ausente o desconocido' };
  if (!esPlanId(x['plan'])) return { ok: false, error: 'Plan desconocido' };
  if (x['comercial'] !== undefined) {
    const c = validarConfiguracionComercial(x['comercial']);
    if (!c.ok) return c;
    const p = validarComercialContraPlan(x['plan'], c.valor);
    if (!p.ok) return p;
  } else if (x['zonaHoraria'] === undefined && x['monedas'] === undefined) {
    return { ok: false, error: 'comercial: el tenant debe declarar sus mercados y monedas' };
  } else {
    const legado = comercialLegado(x);
    if (!legado.ok) return legado;
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
