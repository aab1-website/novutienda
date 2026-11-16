import { registrarAuditoria } from '../auditoria/registrar.js';
import { ContadorCorrupto, rutaContador, verificarYReservar } from '../limites/verificar.js';
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
import { rolEn } from './claim.js';

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
 * `usuarios`, en una transacción (todas las lecturas antes de las escrituras;
 * el contador se actualiza una sola vez). Sin tareas programadas.
 */
async function barrer(deps: DepsInvitar, tenantId: string, uids: readonly string[]): Promise<void> {
  if (uids.length === 0) return;
  const ahora = (deps.ahora ?? Date.now)();
  await deps.db.runTransaction(async (tx) => {
    const caducadas: { uid: string; rol: unknown }[] = [];
    for (const uid of uids) {
      const doc = await tx.get(rutaMiembro(tenantId, uid));
      const d = doc.existe ? doc.data() : undefined;
      if (esInvitado(d) && vencida(d, ahora)) caducadas.push({ uid, rol: d['rolReservado'] });
    }
    if (caducadas.length === 0) return;
    const ruta = rutaContador(tenantId);
    const datos = (await tx.get(ruta)).data() ?? {};
    const usado = datos['usuarios'];
    if (usado !== undefined && (typeof usado !== 'number' || !Number.isSafeInteger(usado) || usado < 0)) {
      throw new ContadorCorrupto('usuarios', usado);
    }
    tx.set(ruta, { ...datos, usuarios: Math.max(0, (usado ?? 0) - caducadas.length) });
    for (const c of caducadas) {
      tx.delete(rutaMiembro(tenantId, c.uid));
      registrarAuditoria(tx, {
        tenantId,
        uid: 'sistema',
        rol: 'adm',
        accion: 'miembro.invitacion-vencida',
        ruta: rutaMiembro(tenantId, c.uid),
        resumenAntes: { estado: 'invitado', rolReservado: esRol(c.rol) ? c.rol : null },
      });
    }
  });
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
 * Idempotente: si `uid` ya es miembro activo o ya está invitado y vigente, no
 * reserva otro cupo ni cambia nada. Una cuenta de OTRO comercio se invita igual.
 * La respuesta es la misma en todos los casos (no revela si la cuenta existía).
 * `cuentaCreada` marca que la cuenta nació con la invitación, para que el
 * borde decida borrarla al anular.
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
  await barrer(deps, tenantId, await deps.indice.invitadosDe(tenantId));
  const ahora = (deps.ahora ?? Date.now)();
  await deps.db.runTransaction(async (tx) => {
    const previo = await tx.get(rutaMiembro(tenantId, uid));
    if (previo.existe) return; // miembro activo o invitación vigente: idempotente, sin cupo nuevo
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
  return { ok: true };
}

/** Invitaciones vigentes del comercio (barre antes las vencidas). Solo administrador del comercio o propietario. */
export async function listarInvitaciones(deps: DepsInvitar, actor: Actor, tenantId: string): Promise<readonly InvitacionVigente[]> {
  validar(tenantId, 'x');
  await autorizar(deps, actor, tenantId);
  const uids = await deps.indice.invitadosDe(tenantId);
  await barrer(deps, tenantId, uids);
  const ahora = (deps.ahora ?? Date.now)();
  return deps.db.runTransaction(async (tx) => {
    const salida: InvitacionVigente[] = [];
    for (const uid of uids) {
      const doc = await tx.get(rutaMiembro(tenantId, uid));
      const d = doc.existe ? doc.data() : undefined;
      if (esInvitado(d) && !vencida(d, ahora)) salida.push(leerInvitacion(uid, d));
    }
    return salida;
  });
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
    const contador = (await tx.get(rutaContador(tenantId))).data() ?? {};
    const usado = contador['usuarios'];
    if (usado !== undefined && (typeof usado !== 'number' || !Number.isSafeInteger(usado) || usado < 0)) {
      throw new ContadorCorrupto('usuarios', usado);
    }
    tx.set(rutaContador(tenantId), { ...contador, usuarios: Math.max(0, (usado ?? 0) - 1) });
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

/** Reenvía una invitación vigente: extiende `venceEnMs` otros 7 días desde ahora. Una vencida ya se barrió (se invita de nuevo). */
export async function reenviarInvitacion(
  deps: DepsInvitar,
  actor: Actor,
  tenantId: string,
  uid: string,
): Promise<{ readonly venceEnMs: number }> {
  validar(tenantId, uid);
  await autorizar(deps, actor, tenantId);
  await barrer(deps, tenantId, [uid]);
  const ahora = (deps.ahora ?? Date.now)();
  return deps.db.runTransaction(async (tx) => {
    const doc = await tx.get(rutaMiembro(tenantId, uid));
    const d = doc.existe ? doc.data() : undefined;
    if (!esInvitado(d)) throw new ErrorIdentidad('no-miembro', 'No hay invitación vigente para ese usuario');
    const venceEnMs = ahora + CADUCIDAD_INVITACION_MS;
    tx.set(rutaMiembro(tenantId, uid), { ...d, venceEnMs });
    registrarAuditoria(tx, {
      tenantId,
      uid: actor.uid,
      rol: 'adm',
      accion: 'miembro.reenviar-invitacion',
      ruta: rutaMiembro(tenantId, uid),
      resumenDespues: { venceEnMs },
    });
    return { venceEnMs };
  });
}

interface Activacion {
  readonly datos: Datos;
  readonly rol: Rol;
  readonly adminsPrevios: number;
}

/**
 * Activa las invitaciones vigentes de `uid` (al verificar su correo): pone
 * `rol = rolReservado`, `estado = 'activo'`, cuenta al administrador en el
 * contador igual que `asignarRol`, escribe el claim y audita
 * `miembro.activar` por cada comercio. Barre las vencidas de ese uid (liberan
 * cupo). Idempotente: sin invitaciones vigentes no hace nada. Exige correo
 * verificado (dato del llamador): si no, `correo-no-verificado`. Devuelve los
 * comercios activados. Si falla el claim, restituye la invitación.
 */
export async function activarInvitaciones(
  deps: DepsInvitar,
  uid: string,
  correoVerificado: boolean,
): Promise<{ readonly tenants: readonly string[] }> {
  if (uid === '' || uid.includes('/')) throw new ErrorIdentidad('entrada-invalida', 'uid inválido');
  if (correoVerificado !== true) throw new ErrorIdentidad('correo-no-verificado', 'El correo debe estar verificado');
  return enSerie(uid, async () => {
    const activados: string[] = [];
    for (const tenantId of await deps.indice.tenantsDe(uid)) {
      if (!esTenantIdValido(tenantId)) continue;
      await barrer(deps, tenantId, [uid]);
      const destino = await deps.auth.getUser(uid);
      if (!destino.providerData.some((p) => p.providerId === 'password')) {
        throw new ErrorIdentidad('proveedor', 'El personal debe ingresar con correo y contraseña');
      }
      const { previo, base } = claimDe(destino);
      const ahora = (deps.ahora ?? Date.now)();
      const ruta = rutaMiembro(tenantId, uid);
      const act = await deps.db.runTransaction<Activacion | undefined>(async (tx) => {
        const doc = await tx.get(ruta);
        const roles = await tx.get(rutaRoles(tenantId));
        const d = doc.existe ? doc.data() : undefined;
        if (!esInvitado(d) || vencida(d, ahora)) return undefined;
        const rol = leerInvitacion(uid, d).rolReservado;
        componerClaim(previo, base, tenantId, rol); // falla temprano si el claim no cabe
        const adminsPrevios = leerAdmins(roles.data());
        tx.set(ruta, { rol, estado: 'activo', actualizado: ahora, por: String(d['invitadoPor']) });
        if (rol === 'adm') tx.set(rutaRoles(tenantId), { adm: adminsPrevios + 1 });
        registrarAuditoria(tx, {
          tenantId,
          uid,
          rol,
          accion: 'miembro.activar',
          ruta,
          resumenAntes: { estado: 'invitado' },
          resumenDespues: { estado: 'activo', rol },
        });
        return { datos: d, rol, adminsPrevios };
      });
      if (act === undefined) continue;
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
      activados.push(tenantId);
    }
    return { tenants: activados };
  });
}

/** Devuelve la membresía al estado invitado (y el contador de administradores) si no se pudo escribir el claim. */
async function restituir(deps: DepsInvitar, tenantId: string, uid: string, act: Activacion): Promise<void> {
  try {
    await deps.db.runTransaction(async (tx: TransaccionIdentidad) => {
      await tx.get(rutaMiembro(tenantId, uid));
      tx.set(rutaMiembro(tenantId, uid), { ...act.datos });
      if (act.rol === 'adm') tx.set(rutaRoles(tenantId), { adm: act.adminsPrevios });
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
    throw new ErrorIdentidad('estado', `No se pudo restituir la invitación de ${uid}; revisar a mano`);
  }
}
