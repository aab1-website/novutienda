import { registrarAuditoria } from '../auditoria/registrar.js';
import { liberar, verificarYReservar } from '../limites/verificar.js';
import type { Rol } from '../registro/tipos.js';
import { esTenantIdValido } from '../tenant/tenant.js';
import {
  autorizar,
  claimDe,
  componerClaim,
  enSerie,
  ErrorIdentidad,
  escribirClaim,
  esRol,
  leerAdmins,
  rutaRoles,
  type Actor,
  type DepsIdentidad,
  type TransaccionIdentidad,
} from './asignar.js';
import { leerClaim, rolEn } from './claim.js';

/** Caducidad de una invitación: 7 días (decisión del dueño del producto, 16/11/2026). */
export const CADUCIDAD_INVITACION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Consultas que el puerto transaccional no ofrece (solo lee por ruta). El borde
 * las implementa con Firestore: `invitadosDe` sobre `tenants/{t}/miembros` con
 * `estado == 'invitado'`; `tenantsDe` como consulta de grupo de colección sobre
 * `miembros` con `estado == 'invitado'` y `uid == uid`. Devuelven candidatos: el
 * núcleo relee y confirma cada documento dentro de su transacción.
 */
export interface IndiceInvitaciones {
  invitadosDe(tenantId: string): Promise<readonly string[]>;
  tenantsDe(uid: string): Promise<readonly string[]>;
}

export interface DepsInvitar extends DepsIdentidad {
  readonly indice: IndiceInvitaciones;
}

/** Respuesta uniforme: no distingue invitación nueva, repetida ni cuenta ya existente. */
export interface RespuestaInvitar {
  readonly ok: true;
  /** Cuentas creadas por invitaciones que el barrido acaba de borrar por vencidas: el borde decide si borra su cuenta de Auth. */
  readonly cuentasCaducadas: readonly string[];
}

export interface ResultadoActivacion {
  /** Comercios donde la invitación pasó a miembro activo. */
  readonly activados: readonly string[];
  /** Comercios donde la invitación quedó sin efecto (quien invitó ya no administra, o el invitado ya tenía rol): se borró y se liberó el cupo. */
  readonly sinEfecto: readonly string[];
  /** Comercios donde falló la activación; los demás siguen su curso. */
  readonly fallidos: readonly { readonly tenantId: string; readonly codigo: string }[];
}

export interface InvitacionVigente {
  readonly uid: string;
  readonly rolReservado: Rol;
  readonly invitadoPor: string;
  readonly invitadoEnMs: number;
  readonly venceEnMs: number;
}

type Datos = Readonly<Record<string, unknown>>;

const rutaMiembro = (tenantId: string, uid: string): string => `tenants/${tenantId}/miembros/${uid}`;

function validar(tenantId: string, uid: string): void {
  if (!esTenantIdValido(tenantId) || uid === '' || uid.includes('/')) {
    throw new ErrorIdentidad('entrada-invalida', 'tenantId o uid inválido');
  }
}

const esInvitado = (d: Datos | undefined): d is Datos => d !== undefined && d['estado'] === 'invitado';

function leerInvitacion(uid: string, d: Datos): InvitacionVigente {
  const { rolReservado, invitadoPor, invitadoEnMs, venceEnMs } = d;
  if (!esRol(rolReservado) || typeof invitadoPor !== 'string' || typeof invitadoEnMs !== 'number' || typeof venceEnMs !== 'number') {
    throw new ErrorIdentidad('estado', 'Invitación corrupta');
  }
  return { uid, rolReservado, invitadoPor, invitadoEnMs, venceEnMs };
}

const vencida = (d: Datos, ahora: number): boolean => typeof d['venceEnMs'] !== 'number' || d['venceEnMs'] <= ahora;

/**
 * Barrido perezoso: borra las invitaciones vencidas de `uids` y libera su cupo
 * `usuarios` (una transacción por invitación, con `liberar`). Devuelve los uid
 * cuya cuenta nació con la invitación (`cuentaCreada`), para que el borde
 * pueda borrarlas. Sin tareas programadas.
 */
async function barrer(deps: DepsInvitar, tenantId: string, uids: readonly string[]): Promise<readonly string[]> {
  const cuentas: string[] = [];
  const ahora = (deps.ahora ?? Date.now)();
  for (const uid of uids) {
    const creada = await deps.db.runTransaction(async (tx) => {
      const doc = await tx.get(rutaMiembro(tenantId, uid));
      const d = doc.existe ? doc.data() : undefined;
      if (!esInvitado(d) || !vencida(d, ahora)) return undefined;
      await liberar(tx, tenantId, 'usuarios');
      tx.delete(rutaMiembro(tenantId, uid));
      registrarAuditoria(tx, {
        tenantId,
        uid: 'sistema',
        rol: 'adm',
        accion: 'miembro.invitacion-vencida',
        ruta: rutaMiembro(tenantId, uid),
        resumenAntes: { estado: 'invitado', rolReservado: esRol(d['rolReservado']) ? d['rolReservado'] : null },
      });
      return d['cuentaCreada'] === true;
    });
    if (creada === true) cuentas.push(uid);
  }
  return cuentas;
}

/** `true` si la cuenta ya tiene rol en ese comercio según su claim vigente, o es propietaria: la invitación no debe tocar su rol. */
async function yaTieneRol(deps: DepsInvitar, uid: string, tenantId: string): Promise<boolean> {
  try {
    const c = (await deps.auth.getUser(uid)).customClaims;
    if (rolEn(c, tenantId) !== '') return true;
    const l = leerClaim(c);
    return l.ok && l.valor.pl.p === true;
  } catch {
    return false; // la cuenta aún no existe: no tiene rol
  }
}

/**
 * Invita a `uid` al comercio con un rol reservado. En una transacción reserva
 * el cupo `usuarios`, escribe `tenants/{t}/miembros/{uid}` en estado
 * `invitado` (sin campo `rol`: no cuenta como rol ni toca el contador de
 * administradores) y audita `miembro.invitar`. Lanza `LimiteDelPlan` si el
 * cupo está lleno.
 *
 * Jerarquía (decisión del dueño, 16/11/2026; AMPLÍA la de `asignarRol`, donde
 * el administrador no otorga 'adm'): el administrador invita caj, sup y
 * TAMBIÉN adm; el propietario, todos. Caj y sup no invitan (`autorizar` los
 * rechaza). La invitación NO escribe el claim: eso ocurre en la activación.
 *
 * Idempotente: si `uid` ya es miembro activo, ya tiene rol en el claim de este
 * comercio o es propietario, no hace nada (nunca rebaja ni duplica). Si ya está
 * invitado y vigente con otro rol, actualiza `rolReservado` sin reservar otro
 * cupo y audita. Una cuenta de OTRO comercio se invita igual. La respuesta es
 * la misma en todos los casos (no revela si la cuenta existía). `cuentaCreada`
 * marca que la cuenta nació con la invitación, para que el borde decida
 * borrarla al anular.
 */
export async function invitarMiembro(
  deps: DepsInvitar,
  actor: Actor,
  tenantId: string,
  uid: string,
  rolReservado: Rol,
  cuentaCreada = false,
): Promise<RespuestaInvitar> {
  validar(tenantId, uid);
  if (!esRol(rolReservado)) throw new ErrorIdentidad('entrada-invalida', 'Rol inválido');
  await autorizar(deps, actor, tenantId);
  const cuentasCaducadas = await barrer(deps, tenantId, await deps.indice.invitadosDe(tenantId));
  const respuesta: RespuestaInvitar = { ok: true, cuentasCaducadas };
  if (await yaTieneRol(deps, uid, tenantId)) return respuesta;
  const ahora = (deps.ahora ?? Date.now)();
  await deps.db.runTransaction(async (tx) => {
    const previo = await tx.get(rutaMiembro(tenantId, uid));
    if (previo.existe) {
      const d = previo.data();
      if (!esInvitado(d) || d['rolReservado'] === rolReservado) return; // miembro activo o misma invitación: sin cambios
      tx.set(rutaMiembro(tenantId, uid), { ...d, rolReservado }); // otro rol: se actualiza, sin cupo nuevo
      registrarAuditoria(tx, {
        tenantId,
        uid: actor.uid,
        rol: 'adm',
        accion: 'miembro.invitar',
        ruta: rutaMiembro(tenantId, uid),
        resumenAntes: { estado: 'invitado', rolReservado: esRol(d['rolReservado']) ? d['rolReservado'] : null },
        resumenDespues: { estado: 'invitado', rolReservado },
      });
      return;
    }
    await verificarYReservar(tx, tenantId, 'usuarios');
    tx.set(rutaMiembro(tenantId, uid), {
      estado: 'invitado',
      uid,
      rolReservado,
      invitadoPor: actor.uid,
      invitadoEnMs: ahora,
      venceEnMs: ahora + CADUCIDAD_INVITACION_MS,
      cuentaCreada,
    });
    registrarAuditoria(tx, {
      tenantId,
      uid: actor.uid,
      rol: 'adm', // el propietario actúa con privilegio de adm; su calidad queda en el uid
      accion: 'miembro.invitar',
      ruta: rutaMiembro(tenantId, uid),
      resumenDespues: { estado: 'invitado', rolReservado },
    });
  });
  return respuesta;
}

/** Invitaciones vigentes del comercio (barre antes las vencidas). Solo administrador del comercio o propietario. */
export async function listarInvitaciones(
  deps: DepsInvitar,
  actor: Actor,
  tenantId: string,
): Promise<{ readonly invitaciones: readonly InvitacionVigente[]; readonly cuentasCaducadas: readonly string[] }> {
  validar(tenantId, 'x');
  await autorizar(deps, actor, tenantId);
  const uids = await deps.indice.invitadosDe(tenantId);
  const cuentasCaducadas = await barrer(deps, tenantId, uids);
  const ahora = (deps.ahora ?? Date.now)();
  const invitaciones = await deps.db.runTransaction(async (tx) => {
    const salida: InvitacionVigente[] = [];
    for (const uid of uids) {
      const doc = await tx.get(rutaMiembro(tenantId, uid));
      const d = doc.existe ? doc.data() : undefined;
      if (esInvitado(d) && !vencida(d, ahora)) salida.push(leerInvitacion(uid, d));
    }
    return salida;
  });
  return { invitaciones, cuentasCaducadas };
}

/**
 * Anula una invitación: borra el documento, libera el cupo y audita. Devuelve
 * `cuentaCreada` para que el borde decida si borra la cuenta de Auth. No toca
 * a un miembro activo (para eso está `quitarRol`).
 */
export async function anularInvitacion(
  deps: DepsInvitar,
  actor: Actor,
  tenantId: string,
  uid: string,
): Promise<{ readonly cuentaCreada: boolean }> {
  validar(tenantId, uid);
  await autorizar(deps, actor, tenantId);
  return deps.db.runTransaction(async (tx) => {
    const doc = await tx.get(rutaMiembro(tenantId, uid));
    const d = doc.existe ? doc.data() : undefined;
    if (d === undefined) throw new ErrorIdentidad('no-miembro', 'No hay invitación para ese usuario');
    if (!esInvitado(d)) throw new ErrorIdentidad('estado', 'El usuario ya es miembro activo; use quitarRol');
    await liberar(tx, tenantId, 'usuarios');
    tx.delete(rutaMiembro(tenantId, uid));
    registrarAuditoria(tx, {
      tenantId,
      uid: actor.uid,
      rol: 'adm',
      accion: 'miembro.anular-invitacion',
      ruta: rutaMiembro(tenantId, uid),
      resumenAntes: { estado: 'invitado', rolReservado: esRol(d['rolReservado']) ? d['rolReservado'] : null },
    });
    return { cuentaCreada: d['cuentaCreada'] === true };
  });
}

/**
 * Reenvía una invitación: extiende `venceEnMs` 7 días desde ahora. Admite una
 * ya vencida que aún no se barrió (conserva su cupo y su `cuentaCreada`).
 */
export async function reenviarInvitacion(
  deps: DepsInvitar,
  actor: Actor,
  tenantId: string,
  uid: string,
): Promise<{ readonly venceEnMs: number }> {
  validar(tenantId, uid);
  await autorizar(deps, actor, tenantId);
  const ahora = (deps.ahora ?? Date.now)();
  return deps.db.runTransaction(async (tx) => {
    const doc = await tx.get(rutaMiembro(tenantId, uid));
    const d = doc.existe ? doc.data() : undefined;
    if (!esInvitado(d)) throw new ErrorIdentidad('no-miembro', 'No hay invitación para ese usuario');
    const venceEnMs = ahora + CADUCIDAD_INVITACION_MS;
    tx.set(rutaMiembro(tenantId, uid), { ...d, venceEnMs });
    registrarAuditoria(tx, {
      tenantId,
      uid: actor.uid,
      rol: 'adm',
      accion: 'miembro.reenviar-invitacion',
      ruta: rutaMiembro(tenantId, uid),
      resumenAntes: { venceEnMs: typeof d['venceEnMs'] === 'number' ? d['venceEnMs'] : null },
      resumenDespues: { venceEnMs },
    });
    return { venceEnMs };
  });
}

interface Activacion {
  readonly datos: Datos;
  readonly rol: Rol;
}

/** `true` si quien invitó sigue siendo administrador de ese comercio o propietario (claims VIGENTES en Auth). */
async function inviteSigueAutorizado(deps: DepsInvitar, invitador: string, tenantId: string): Promise<boolean> {
  const c = (await deps.auth.getUser(invitador)).customClaims;
  if (rolEn(c, tenantId) === 'adm') return true;
  const l = leerClaim(c);
  return l.ok && l.valor.pl.p === true;
}

/**
 * Activa las invitaciones vigentes de `uid` (al verificar su correo): pone
 * `rol = rolReservado`, `estado = 'activo'`, cuenta al administrador en el
 * contador igual que `asignarRol`, escribe el claim y audita
 * `miembro.activar`, por cada comercio. Reglas:
 * - Exige correo verificado: el dato del llamador Y `emailVerified` leído de
 *   Auth; si no, `correo-no-verificado`.
 * - Si quien invitó ya no es administrador ni propietario del comercio, o el
 *   invitado ya tiene rol en él (o es propietario), la invitación queda sin
 *   efecto: se borra, se libera el cupo y se audita; el rol no se toca.
 * - Barre las vencidas de ese uid (no devuelve su cuenta: acaba de verificar el correo).
 * - El fallo en un comercio no corta los demás: se informa por comercio. Si
 *   falla el claim, se restituye la invitación solo si nadie cambió la
 *   membresía entretanto.
 * Idempotente: sin invitaciones vigentes devuelve listas vacías.
 */
export async function activarInvitaciones(deps: DepsInvitar, uid: string, correoVerificado: boolean): Promise<ResultadoActivacion> {
  if (uid === '' || uid.includes('/')) throw new ErrorIdentidad('entrada-invalida', 'uid inválido');
  if (correoVerificado !== true) throw new ErrorIdentidad('correo-no-verificado', 'El correo debe estar verificado');
  return enSerie(uid, async () => {
    const inicial = await deps.auth.getUser(uid);
    if (inicial.emailVerified !== true) throw new ErrorIdentidad('correo-no-verificado', 'El correo debe estar verificado');
    if (!inicial.providerData.some((p) => p.providerId === 'password')) {
      throw new ErrorIdentidad('proveedor', 'El personal debe ingresar con correo y contraseña');
    }
    const activados: string[] = [];
    const sinEfecto: string[] = [];
    const fallidos: { tenantId: string; codigo: string }[] = [];
    for (const tenantId of await deps.indice.tenantsDe(uid)) {
      if (!esTenantIdValido(tenantId)) continue;
      try {
        const r = await activarEn(deps, uid, tenantId);
        if (r === 'activada') activados.push(tenantId);
        else if (r === 'sin-efecto') sinEfecto.push(tenantId);
      } catch (e) {
        fallidos.push({ tenantId, codigo: e instanceof ErrorIdentidad ? e.codigo : 'error' });
      }
    }
    return { activados, sinEfecto, fallidos };
  });
}

async function activarEn(deps: DepsInvitar, uid: string, tenantId: string): Promise<'activada' | 'sin-efecto' | 'nada'> {
  await barrer(deps, tenantId, [uid]);
  const ruta = rutaMiembro(tenantId, uid);
  const ahora = (deps.ahora ?? Date.now)();
  const vista = await deps.db.runTransaction(async (tx) => {
    const doc = await tx.get(ruta);
    const d = doc.existe ? doc.data() : undefined;
    return esInvitado(d) && !vencida(d, ahora) ? leerInvitacion(uid, d) : undefined;
  });
  if (vista === undefined) return 'nada';

  const destino = await deps.auth.getUser(uid);
  if (destino.emailVerified !== true) throw new ErrorIdentidad('correo-no-verificado', 'El correo debe estar verificado');
  const { previo, base } = claimDe(destino);
  const tieneRol = (base !== undefined && Object.hasOwn(base.t, tenantId)) || base?.p === true;
  let autorizado = false;
  if (!tieneRol) {
    try {
      autorizado = await inviteSigueAutorizado(deps, vista.invitadoPor, tenantId);
    } catch {
      throw new ErrorIdentidad('no-autorizado', 'No se pudo verificar a quien invitó');
    }
  }
  const descartar = tieneRol || !autorizado;
  if (!descartar) componerClaim(previo, base, tenantId, vista.rolReservado); // falla temprano si el claim no cabe

  const act = await deps.db.runTransaction<Activacion | 'sin-efecto' | undefined>(async (tx) => {
    const doc = await tx.get(ruta);
    const roles = await tx.get(rutaRoles(tenantId));
    const d = doc.existe ? doc.data() : undefined;
    if (!esInvitado(d) || vencida(d, ahora) || d['invitadoPor'] !== vista.invitadoPor) return undefined; // cambió entretanto
    if (descartar) {
      await liberar(tx, tenantId, 'usuarios');
      tx.delete(ruta);
      registrarAuditoria(tx, {
        tenantId,
        uid,
        rol: vista.rolReservado,
        accion: 'miembro.invitacion-sin-efecto',
        ruta,
        resumenAntes: { estado: 'invitado', rolReservado: vista.rolReservado },
      });
      return 'sin-efecto';
    }
    const rol = vista.rolReservado;
    tx.set(ruta, { rol, estado: 'activo', actualizado: ahora, por: vista.invitadoPor });
    if (rol === 'adm') tx.set(rutaRoles(tenantId), { adm: leerAdmins(roles.data()) + 1 });
    registrarAuditoria(tx, {
      tenantId,
      uid,
      rol,
      accion: 'miembro.activar',
      ruta,
      resumenAntes: { estado: 'invitado' },
      resumenDespues: { estado: 'activo', rol },
    });
    return { datos: d, rol };
  });
  if (act === undefined) return 'nada';
  if (act === 'sin-efecto') return 'sin-efecto';
  try {
    await escribirClaim(deps, uid, tenantId, act.rol);
  } catch (e) {
    let vigente: Rol | '' | 'desconocido';
    try {
      vigente = rolEn((await deps.auth.getUser(uid)).customClaims, tenantId);
    } catch {
      vigente = 'desconocido';
    }
    if (vigente === 'desconocido' || vigente === act.rol) {
      throw new ErrorIdentidad('estado', 'Claim sin confirmar; espejo conservado, revisar');
    }
    await restituir(deps, tenantId, uid, act);
    throw e;
  }
  return 'activada';
}

/**
 * Devuelve la membresía al estado invitado si no se pudo escribir el claim,
 * SOLO si sigue `activo` con el mismo rol (si otro proceso la cambió o la
 * quitó, no se toca nada: evita recrear la invitación o liberar dos veces el
 * cupo). El contador de administradores se lee dentro de la transacción y se
 * resta 1, nunca se escribe un valor absoluto.
 */
async function restituir(deps: DepsInvitar, tenantId: string, uid: string, act: Activacion): Promise<void> {
  try {
    await deps.db.runTransaction(async (tx: TransaccionIdentidad) => {
      const doc = await tx.get(rutaMiembro(tenantId, uid));
      const roles = await tx.get(rutaRoles(tenantId));
      const d = doc.existe ? doc.data() : undefined;
      if (d === undefined || d['estado'] !== 'activo' || d['rol'] !== act.rol) return;
      tx.set(rutaMiembro(tenantId, uid), { ...act.datos });
      if (act.rol === 'adm') tx.set(rutaRoles(tenantId), { adm: Math.max(0, leerAdmins(roles.data()) - 1) });
      registrarAuditoria(tx, {
        tenantId,
        uid,
        rol: act.rol,
        accion: 'miembro.revertir-activacion',
        ruta: rutaMiembro(tenantId, uid),
        resumenDespues: { estado: 'invitado' },
      });
    });
  } catch {
    throw new ErrorIdentidad('estado', 'No se pudo restituir la invitación; revisar a mano');
  }
}
