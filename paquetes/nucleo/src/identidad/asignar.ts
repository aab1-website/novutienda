import type { ClaimPlataforma } from '../contratos/claim.js';
import { verificarYReservar } from '../limites/verificar.js';
import type { BaseDatosMin } from '../limites/transaccion.js';
import type { Rol } from '../registro/tipos.js';
import { esTenantIdValido } from '../tenant/tenant.js';
import { construirClaim, esPropietario, leerClaim, proveedorDe, rolEn } from './claim.js';

export type CodigoErrorIdentidad = 'no-autorizado' | 'anonimo' | 'entrada-invalida' | 'proveedor' | 'claim';

export class ErrorIdentidad extends Error {
  constructor(
    readonly codigo: CodigoErrorIdentidad,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = 'ErrorIdentidad';
  }
}

/** Interfaz mínima de Firebase Auth (Admin SDK) que usa la asignación. */
export interface AuthMin {
  getUser(uid: string): Promise<{
    readonly customClaims?: Readonly<Record<string, unknown>> | undefined;
    readonly providerData: readonly { readonly providerId: string }[];
  }>;
  setCustomUserClaims(uid: string, claims: Readonly<Record<string, unknown>>): Promise<void>;
}

export interface DepsIdentidad {
  readonly auth: AuthMin;
  readonly db: BaseDatosMin;
  /** Marca de tiempo en milisegundos (inyectable para pruebas). */
  readonly ahora?: () => number;
}

/** Quien invoca: uid y claims del token decodificado. */
export interface Actor {
  readonly uid: string;
  readonly claims: unknown;
}

const ROLES: readonly string[] = ['caj', 'sup', 'adm', 'dir'];

/**
 * Asigna un rol a un usuario del tenant. Autoriza al administrador del tenant
 * (sesión con correo y contraseña) o al propietario de la plataforma (sesión
 * con Google). El anónimo nunca. Reserva el cupo de usuarios, escribe el
 * espejo `tenants/{t}/miembros/{uid}` y después actualiza el claim.
 */
export async function asignarRol(
  deps: DepsIdentidad,
  actor: Actor,
  tenantId: string,
  uid: string,
  rol: Rol,
): Promise<ClaimPlataforma> {
  if (!esTenantIdValido(tenantId) || uid === '' || uid.includes('/') || !ROLES.includes(rol)) {
    throw new ErrorIdentidad('entrada-invalida', 'tenantId, uid o rol inválido');
  }
  const proveedor = proveedorDe(actor.claims);
  if (proveedor === 'anonymous') throw new ErrorIdentidad('anonimo', 'Una sesión anónima no puede asignar roles');
  const propietario = esPropietario(actor.claims);
  const adminDelTenant = proveedor === 'password' && rolEn(actor.claims, tenantId) === 'adm';
  if (!propietario && !adminDelTenant) {
    throw new ErrorIdentidad('no-autorizado', 'Solo el administrador del tenant o el propietario asignan roles');
  }

  const destino = await deps.auth.getUser(uid);
  if (!destino.providerData.some((p) => p.providerId === 'password')) {
    throw new ErrorIdentidad('proveedor', 'El personal debe ingresar con correo y contraseña');
  }
  const previo = destino.customClaims;
  const actual = previo !== undefined && 'pl' in previo ? leerClaim(previo) : undefined;
  if (actual !== undefined && !actual.ok) throw new ErrorIdentidad('claim', actual.error);
  const base = actual?.valor.pl;
  const nuevo = construirClaim({ ...(base?.t ?? {}), [tenantId]: rol }, (base?.v ?? 0) + 1, base?.p === true);
  if (!nuevo.ok) throw new ErrorIdentidad('claim', nuevo.error);

  const ahora = deps.ahora ?? Date.now;
  const rutaMiembro = `tenants/${tenantId}/miembros/${uid}`;
  await deps.db.runTransaction(async (tx) => {
    const miembro = await tx.get(rutaMiembro);
    if (!miembro.existe) await verificarYReservar(tx, tenantId, 'usuarios');
    tx.set(rutaMiembro, { rol, actualizado: ahora(), por: actor.uid });
  });
  // Si esto falla, reintentar es idempotente: el miembro ya existe y no consume otro cupo.
  await deps.auth.setCustomUserClaims(uid, { ...(previo ?? {}), ...nuevo.valor });
  return nuevo.valor;
}
