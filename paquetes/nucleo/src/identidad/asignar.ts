import type { ClaimPlataforma } from '../contratos/claim.js';
import { registrarAuditoria, type TransaccionAuditoria } from '../auditoria/registrar.js';
import { liberar, verificarYReservar } from '../limites/verificar.js';
import type { TransaccionMin } from '../limites/transaccion.js';
import type { Rol } from '../registro/tipos.js';
import { esTenantIdValido } from '../tenant/tenant.js';
import { bytesClaimCompleto, construirClaim, leerClaim, LIMITE_BYTES_CLAIM, proveedorDe, rolEn } from './claim.js';

export type CodigoErrorIdentidad =
  | 'no-autorizado'
  | 'anonimo'
  | 'entrada-invalida'
  | 'proveedor'
  | 'claim'
  | 'correo-no-verificado'
  | 'jerarquia'
  | 'ultimo-adm'
  | 'no-miembro'
  | 'estado'
  | 'concurrencia';

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
    readonly emailVerified: boolean;
  }>;
  setCustomUserClaims(uid: string, claims: Readonly<Record<string, unknown>>): Promise<void>;
  /** Invalida los tokens de actualización: la sesión vigente cae en la siguiente renovación. */
  revokeRefreshTokens(uid: string): Promise<void>;
}

/** Transacción de identidad: lectura/escritura, borrado y auditoría en la misma transacción. */
export interface TransaccionIdentidad extends TransaccionMin, TransaccionAuditoria {
  delete(ruta: string): void;
}

export interface BaseDatosIdentidad {
  /** Ejecuta `fn` de forma atómica y serializable (reintenta ante conflicto). */
  runTransaction<T>(fn: (tx: TransaccionIdentidad) => Promise<T>): Promise<T>;
}

export interface DepsIdentidad {
  readonly auth: AuthMin;
  readonly db: BaseDatosIdentidad;
  /** Marca de tiempo en milisegundos (inyectable para pruebas). */
  readonly ahora?: () => number;
}

/** Quien invoca: uid y claims del token decodificado. */
export interface Actor {
  readonly uid: string;
  readonly claims: unknown;
}

const ROLES: readonly string[] = ['caj', 'sup', 'adm', 'dir'];
const RANGO: { readonly [r in Rol]: number } = { caj: 1, sup: 2, adm: 3, dir: 4 };
const INTENTOS_CLAIM = 3;

const esRol = (x: unknown): x is Rol => typeof x === 'string' && ROLES.includes(x);

/** Serialización por uid dentro del proceso (la carrera entre procesos se detecta con la versión `v`). */
const colas = new Map<string, Promise<unknown>>();
function enSerie<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  const previa = colas.get(uid) ?? Promise.resolve();
  const actual = previa.then(fn, fn);
  const marca = actual.then(
    () => undefined,
    () => undefined,
  );
  colas.set(uid, marca);
  void marca.then(() => {
    if (colas.get(uid) === marca) colas.delete(uid);
  });
  return actual;
}

const rutaRoles = (tenantId: string): string => `tenants/${tenantId}/contadores/roles`;

function leerAdmins(datos: Readonly<Record<string, unknown>> | undefined): number {
  const n = datos?.['adm'];
  if (n === undefined) return 0;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) {
    throw new ErrorIdentidad('estado', 'Contador de administradores corrupto');
  }
  return n;
}

interface Autorizacion {
  readonly propietario: boolean;
}

/**
 * Autoriza leyendo el estado VIGENTE del actor (claims actuales en Auth), no
 * solo el token: un administrador degradado con un token previo no puede operar.
 * El proveedor sí se toma del token (es de la sesión).
 */
async function autorizar(deps: DepsIdentidad, actor: Actor, tenantId: string): Promise<Autorizacion> {
  const proveedor = proveedorDe(actor.claims);
  if (proveedor === 'anonymous') throw new ErrorIdentidad('anonimo', 'Una sesión anónima no puede cambiar roles');
  let vigentes: Readonly<Record<string, unknown>> | undefined;
  try {
    vigentes = (await deps.auth.getUser(actor.uid)).customClaims;
  } catch {
    throw new ErrorIdentidad('no-autorizado', 'No se pudo verificar al actor');
  }
  const c = leerClaim(vigentes);
  const propietario = proveedor === 'google.com' && c.ok && c.valor.pl.p === true;
  const adminDelTenant = proveedor === 'password' && rolEn(vigentes, tenantId) === 'adm';
  if (!propietario && !adminDelTenant) {
    throw new ErrorIdentidad('no-autorizado', 'Solo el administrador del tenant o el propietario cambian roles');
  }
  return { propietario };
}

/**
 * Jerarquía: el adm administra a caj y sup; solo el propietario otorga, degrada
 * o quita cualquier otro rol (adm) y toca al propietario.
 */
function verificarJerarquia(aut: Autorizacion, rolNuevo: Rol | null, rolPrevio: Rol | '', destinoEsPropietario: boolean): void {
  if (aut.propietario) return;
  const gestionable = (r: Rol | ''): boolean => r === '' || r === 'caj' || r === 'sup';
  if (rolNuevo !== null && !gestionable(rolNuevo)) {
    throw new ErrorIdentidad('jerarquia', 'Solo el propietario de la plataforma asigna ese rol');
  }
  if (!gestionable(rolPrevio) || destinoEsPropietario) {
    throw new ErrorIdentidad('jerarquia', 'Solo el propietario de la plataforma cambia o quita a un administrador');
  }
}

function claimDe(destino: { readonly customClaims?: Readonly<Record<string, unknown>> | undefined }) {
  const previo = destino.customClaims;
  const leido = previo !== undefined && 'pl' in previo ? leerClaim(previo) : undefined;
  if (leido !== undefined && !leido.ok) throw new ErrorIdentidad('claim', leido.error);
  return { previo, base: leido?.valor.pl };
}

/** Claim nuevo para `tenantId` (rol o quitado), validado y medido sobre el claim COMPLETO combinado. */
function componerClaim(
  previo: Readonly<Record<string, unknown>> | undefined,
  base: ClaimPlataforma['pl'] | undefined,
  tenantId: string,
  rol: Rol | null,
): { readonly claim: ClaimPlataforma; readonly completo: Record<string, unknown> } {
  const roles: Record<string, Rol> = { ...(base?.t ?? {}) };
  if (rol === null) delete roles[tenantId];
  else roles[tenantId] = rol;
  const nuevo = construirClaim(roles, (base?.v ?? 0) + 1, base?.p === true);
  if (!nuevo.ok) throw new ErrorIdentidad('claim', nuevo.error);
  const completo = { ...(previo ?? {}), ...nuevo.valor };
  if (bytesClaimCompleto(completo) >= LIMITE_BYTES_CLAIM) {
    throw new ErrorIdentidad('claim', 'Claim completo de 1000 bytes o más');
  }
  return { claim: nuevo.valor, completo };
}

interface Estado {
  readonly existia: boolean;
  readonly rolPrevio: Rol | '';
  readonly datosPrevios: Readonly<Record<string, unknown>> | undefined;
  readonly adminsPrevios: number;
}

/**
 * Núcleo común de asignar y quitar. `rol === null` quita al miembro.
 * Orden: 1) autoriza con estado vigente; 2) transacción (espejo, cupo,
 * contador de administradores y auditoría); 3) claim; 4) revoca sesiones si el
 * rol baja. Si falla el claim, se revierte el espejo con otra transacción.
 */
async function cambiarRol(
  deps: DepsIdentidad,
  actor: Actor,
  tenantId: string,
  uid: string,
  rol: Rol | null,
): Promise<ClaimPlataforma> {
  if (!esTenantIdValido(tenantId) || uid === '' || uid.includes('/') || (rol !== null && !esRol(rol))) {
    throw new ErrorIdentidad('entrada-invalida', 'tenantId, uid o rol inválido');
  }
  const aut = await autorizar(deps, actor, tenantId);
  return enSerie(uid, async () => {
    const destino = await deps.auth.getUser(uid);
    if (rol !== null) {
      if (!destino.providerData.some((p) => p.providerId === 'password')) {
        throw new ErrorIdentidad('proveedor', 'El personal debe ingresar con correo y contraseña');
      }
      if (destino.emailVerified !== true) {
        throw new ErrorIdentidad('correo-no-verificado', 'El correo del usuario debe estar verificado');
      }
    }
    const { previo, base } = claimDe(destino);
    const rolClaim: Rol | '' = base !== undefined && Object.hasOwn(base.t, tenantId) ? (base.t[tenantId] ?? '') : '';
    verificarJerarquia(aut, rol, rolClaim, base?.p === true);
    componerClaim(previo, base, tenantId, rol); // falla temprano si el claim no cabe

    const ahora = deps.ahora ?? Date.now;
    const rutaMiembro = `tenants/${tenantId}/miembros/${uid}`;
    const estado = await deps.db.runTransaction<Estado>(async (tx) => {
      const miembro = await tx.get(rutaMiembro);
      const roles = await tx.get(rutaRoles(tenantId));
      const datosPrevios = miembro.existe ? miembro.data() : undefined;
      const rolMirror = datosPrevios?.['rol'];
      const rolPrevio: Rol | '' = esRol(rolMirror) ? rolMirror : rolClaim;
      verificarJerarquia(aut, rol, rolPrevio, base?.p === true);
      const adminsPrevios = leerAdmins(roles.data());
      let admins = adminsPrevios;
      if (rol === null) {
        if (!miembro.existe && rolClaim === '') throw new ErrorIdentidad('no-miembro', 'El usuario no es miembro del tenant');
        if (rolPrevio === 'adm' && admins <= 1) {
          throw new ErrorIdentidad('ultimo-adm', 'No se puede quitar al último administrador');
        }
        if (miembro.existe) await liberar(tx, tenantId, 'usuarios');
        tx.delete(rutaMiembro);
      } else {
        if (!miembro.existe) await verificarYReservar(tx, tenantId, 'usuarios');
        tx.set(rutaMiembro, { rol, actualizado: ahora(), por: actor.uid });
      }
      if (rolPrevio === 'adm' && rol !== 'adm') admins = Math.max(0, admins - 1);
      else if (rolPrevio !== 'adm' && rol === 'adm') admins += 1;
      tx.set(rutaRoles(tenantId), { adm: admins });
      registrarAuditoria(tx, {
        tenantId,
        uid: actor.uid,
        rol: 'adm', // el propietario actúa con privilegio de adm; su calidad queda en el uid
        accion: rol === null ? 'miembro.quitar-rol' : 'miembro.asignar-rol',
        ruta: rutaMiembro,
        resumenAntes: { rol: rolPrevio === '' ? null : rolPrevio },
        resumenDespues: { rol },
      });
      return { existia: miembro.existe, rolPrevio, datosPrevios, adminsPrevios };
    });

    let claim: ClaimPlataforma;
    try {
      claim = await escribirClaim(deps, uid, tenantId, rol);
    } catch (e) {
      await revertirEspejo(deps, actor, aut, tenantId, uid, rutaMiembro, estado);
      throw e;
    }
    const baja = rol === null || (estado.rolPrevio !== '' && RANGO[rol] < RANGO[estado.rolPrevio]);
    if (baja) await deps.auth.revokeRefreshTokens(uid);
    return claim;
  });
}

/**
 * Escribe el claim releyendo el estado vigente justo antes (versión `v`) y
 * comprobando después; si otro proceso lo cambió en medio, recompone y reintenta.
 */
async function escribirClaim(deps: DepsIdentidad, uid: string, tenantId: string, rol: Rol | null): Promise<ClaimPlataforma> {
  for (let intento = 0; intento < INTENTOS_CLAIM; intento++) {
    const { previo, base } = claimDe(await deps.auth.getUser(uid));
    const { claim, completo } = componerClaim(previo, base, tenantId, rol);
    await deps.auth.setCustomUserClaims(uid, completo);
    const { base: tras } = claimDe(await deps.auth.getUser(uid));
    const rolTras = tras !== undefined && Object.hasOwn(tras.t, tenantId) ? tras.t[tenantId] : undefined;
    if (tras?.v === claim.pl.v && rolTras === (rol ?? undefined)) return claim;
  }
  throw new ErrorIdentidad('concurrencia', 'El claim cambió de forma concurrente; reintente la operación');
}

/** Deja el espejo como estaba antes si no se pudo escribir el claim (espejo y claim no quedan en desacuerdo). */
async function revertirEspejo(
  deps: DepsIdentidad,
  actor: Actor,
  aut: Autorizacion,
  tenantId: string,
  uid: string,
  rutaMiembro: string,
  estado: Estado,
): Promise<void> {
  try {
    await deps.db.runTransaction(async (tx) => {
      const rolActual = (await tx.get(rutaMiembro)).data()?.['rol'];
      if (estado.existia) {
        tx.set(rutaMiembro, { ...(estado.datosPrevios ?? {}) });
        if (!esRol(rolActual)) await verificarYReservar(tx, tenantId, 'usuarios');
      } else {
        tx.delete(rutaMiembro);
        if (esRol(rolActual)) await liberar(tx, tenantId, 'usuarios');
      }
      tx.set(rutaRoles(tenantId), { adm: estado.adminsPrevios });
      registrarAuditoria(tx, {
        tenantId,
        uid: actor.uid,
        rol: 'adm', // el propietario actúa con privilegio de adm; su calidad queda en el uid
        accion: 'miembro.revertir-rol',
        ruta: rutaMiembro,
        resumenAntes: { rol: esRol(rolActual) ? rolActual : null },
        resumenDespues: { rol: estado.rolPrevio === '' ? null : estado.rolPrevio },
      });
    });
  } catch {
    throw new ErrorIdentidad('estado', `No se pudo revertir el espejo de ${uid}; revisar a mano`);
  }
}

/**
 * Asigna un rol a un usuario del tenant. Autoriza al administrador del tenant
 * (sesión con correo y contraseña) o al propietario de la plataforma (sesión
 * con Google) según su estado VIGENTE; el anónimo nunca. Exige correo
 * verificado en el destino, reserva el cupo de usuarios, escribe el espejo
 * `tenants/{t}/miembros/{uid}`, audita en la misma transacción y actualiza el
 * claim. Revoca sesiones si el rol baja. Solo el propietario asigna 'adm'.
 */
export function asignarRol(
  deps: DepsIdentidad,
  actor: Actor,
  tenantId: string,
  uid: string,
  rol: Rol,
): Promise<ClaimPlataforma> {
  return cambiarRol(deps, actor, tenantId, uid, rol);
}

/**
 * Quita a un usuario del tenant: borra el espejo, libera el cupo, retira el
 * claim de ese tenant (conserva los demás), revoca sesiones y audita. No se
 * puede quitar al último administrador.
 */
export function quitarRol(deps: DepsIdentidad, actor: Actor, tenantId: string, uid: string): Promise<ClaimPlataforma> {
  return cambiarRol(deps, actor, tenantId, uid, null);
}
