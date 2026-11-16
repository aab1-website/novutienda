// Acciones de usuarios del tenant (Central, plano §5.2): lo que todo comercio ve igual tenga los módulos que tenga.
// Viajan dentro del callable `consola` (`index.ts` las compone con `accionesConsola`) para no cambiar el contrato del
// panel; los roles y el permiso del propietario los declara el manifiesto del panel.
import { randomBytes } from 'node:crypto';
import { logger } from 'firebase-functions';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  activarInvitaciones, anularInvitacion, asignarRol, invitarMiembro, leerClaim, listarInvitaciones, proveedorDe, quitarRol, reenviarInvitacion,
  type DepsInvitar, type IndiceInvitaciones, type LimiteTasa, type Rol,
} from '@novutienda/nucleo';
import { accion, comoHttpsError, moduloApagado, type Contexto, type TablaImplementaciones } from './marco.js';
import { exigirAppCheck } from '../autenticacion.js';
import type { Entorno } from '../entorno.js';
import { UID, VACIO, objeto } from './comunes.js';
import { vistaComercial } from '../../../coordinador/comercial.js';

const ruta = (t: string, col: string, id?: string): string => `tenants/${t}/${col}${id === undefined ? '' : `/${id}`}`;

const ROL = z.enum(['caj', 'sup', 'adm']);

/** Texto único de la respuesta de invitar y reenviar: igual exista o no la cuenta y pertenezca o no a otro comercio. */
const MENSAJE_INVITACION = 'Invitación enviada';
/** Tope de invitaciones y reenvíos por comercio y hora (el límite es del actor, no del correo). */
export const MAXIMO_INVITACIONES_POR_HORA = 5;
export const VENTANA_INVITACIONES_MS = 3_600_000;
/** Tope de activaciones por persona y hora. */
export const MAXIMO_ACTIVACIONES_POR_HORA = 10;

/**
 * Puertos que el coordinador debe sumar al `Entorno` (el marco no los trae todavía):
 * - `indiceInvitaciones`: consulta de grupo sobre `miembros` (`estado == 'invitado'`; por `uid`) del núcleo.
 * - `limiteInvitaciones`: `LimiteTasa` de 5 por hora (`MAXIMO_INVITACIONES_POR_HORA`, `VENTANA_INVITACIONES_MS`), con clave por comercio.
 */
export interface PuertosInvitacion {
  readonly indiceInvitaciones: IndiceInvitaciones;
  readonly limiteInvitaciones: LimiteTasa;
}

function puertos(e: Entorno): PuertosInvitacion {
  const p = e as Partial<PuertosInvitacion>;
  if (p.indiceInvitaciones === undefined || p.limiteInvitaciones === undefined) {
    // Falla cerrado y sin detalles: faltó la conexión del coordinador.
    throw new HttpsError('internal', 'Error interno.');
  }
  return { indiceInvitaciones: p.indiceInvitaciones, limiteInvitaciones: p.limiteInvitaciones };
}

const depsInvitar = (e: Entorno): DepsInvitar => ({ auth: e.authMin, db: e.db, ahora: e.ahora, indice: puertos(e).indiceInvitaciones });

async function limitarInvitaciones(c: Contexto): Promise<void> {
  const r = await puertos(c.e).limiteInvitaciones.intentar(`invitar:${c.tenantId}`, c.e.ahora());
  if (!r.permitido) {
    throw new HttpsError('resource-exhausted', 'Se enviaron demasiadas invitaciones. Intente de nuevo más tarde.', { codigo: 'limite-invitaciones', reintentarEnSeg: r.reintentarEnSeg });
  }
}

const sinCuenta = (error: unknown): boolean => (error as { code?: unknown }).code === 'auth/user-not-found';

/**
 * Borra la cuenta de Auth de una invitación SOLO si la creó la invitación (el núcleo lo marca con `cuentaCreada`), no tiene
 * otras membresías ni invitaciones y nunca inició sesión. Cualquier duda conserva la cuenta. Sin correos ni uids en el registro.
 */
async function borrarCuentaDeInvitacion(e: Entorno, uid: string): Promise<boolean> {
  try {
    const libre = async (): Promise<boolean> => {
      const u = await e.auth.getUser(uid);
      // Auth marca `lastSignInTime` igual a `creationTime` en una cuenta creada por el Admin SDK que nadie usó: «nunca inició sesión»
      // es no haber renovado el token y no tener un ingreso posterior a la creación. Un valor ausente o ilegible se trata como uso.
      if (u.metadata.lastRefreshTime) return false;
      const ingreso = u.metadata.lastSignInTime ? Date.parse(u.metadata.lastSignInTime) : Number.NaN;
      if (Number.isNaN(ingreso) && u.metadata.lastSignInTime) return false;
      if (!Number.isNaN(ingreso) && ingreso !== Date.parse(u.metadata.creationTime)) return false;
      if (u.customClaims !== undefined && Object.keys(u.customClaims).length > 0) return false; // alguna membresía o permiso: se conserva
      return (await puertos(e).indiceInvitaciones.tenantsDe(uid)).length === 0;
    };
    // Dos lecturas, la segunda justo antes de borrar: otra invitación o una activación pudo llegar entre ambas. Ante la duda, no se borra.
    if (!(await libre()) || !(await libre())) return false;
    await e.auth.deleteUser(uid);
    return true;
  } catch (error) {
    if (!sinCuenta(error)) logger.warn('no se pudo limpiar una cuenta de invitación', { alerta: 'invitaciones' });
    return false;
  }
}

const borrarCuentas = async (e: Entorno, uids: readonly string[]): Promise<void> => {
  for (const uid of uids) await borrarCuentaDeInvitacion(e, uid);
};

/** Cuenta para el correo: la existente (solo con contraseña) o una nueva con clave aleatoria que nadie conoce. `undefined` si no sirve. */
async function cuentaParaInvitar(e: Entorno, correo: string): Promise<{ readonly uid: string; readonly creada: boolean } | undefined> {
  const existente = async (): Promise<{ uid: string; creada: boolean } | undefined> => {
    const u = await e.auth.getUserByEmail(correo);
    return u.providerData.some((p) => p.providerId === 'password') ? { uid: u.uid, creada: false } : undefined;
  };
  try {
    return await existente();
  } catch (error) {
    if (!sinCuenta(error)) throw error;
  }
  try {
    // La clave es aleatoria, no se guarda ni se devuelve: la persona fija la suya con el enlace del correo.
    const nueva = await e.auth.createUser({ email: correo, password: randomBytes(32).toString('base64url'), emailVerified: false });
    return { uid: nueva.uid, creada: true };
  } catch (error) {
    if ((error as { code?: unknown }).code === 'auth/email-already-exists') return existente(); // carrera con otra invitación
    throw error;
  }
}

export const accionesUsuarios: TablaImplementaciones = {
  // ---- Usuarios (3 como máximo) ---------------------------------------------------------------------------
  /** Miembros del tenant con su correo (`sup`/`adm`). */
  listarUsuarios: accion({
    esquema: VACIO,
    ejecutar: async (c) => {
      const docs = (await c.e.firestore.collection(ruta(c.tenantId, 'miembros')).get()).docs;
      const activos = docs.filter((m) => m.data()['estado'] !== 'invitado' && typeof m.data()['rol'] === 'string');
      // Las invitaciones las ve solo quien administra (`adm` o propietario); `sup` sigue viendo solo a los miembros.
      const invitaciones =
        c.rol === 'adm' || c.rol === undefined
          ? await listarInvitaciones(depsInvitar(c.e), c.actor, c.tenantId)
          : { invitaciones: [], cuentasCaducadas: [] as readonly string[] };
      await borrarCuentas(c.e, invitaciones.cuentasCaducadas);
      const uids = [...activos.map((m) => m.id), ...invitaciones.invitaciones.map((i) => i.uid)].slice(0, 100);
      if (uids.length === 0) return { usuarios: [] };
      const { users } = await c.e.auth.getUsers(uids.map((uid) => ({ uid })));
      const porUid = new Map(users.map((u) => [u.uid, u]));
      return {
        usuarios: [
          ...activos.map((m) => {
            const u = porUid.get(m.id);
            return { uid: m.id, rol: m.data()['rol'], correo: u?.email ?? null, correoVerificado: u?.emailVerified ?? false, deshabilitado: u?.disabled ?? false };
          }),
          // Solo lo que el administrador ya ve de un miembro (correo) más lo propio de la invitación: nunca la verificación de la cuenta.
          ...invitaciones.invitaciones.map((i) => ({ uid: i.uid, estado: 'invitado', rolReservado: i.rolReservado, venceEnMs: i.venceEnMs, correo: porUid.get(i.uid)?.email ?? null })),
        ],
      };
    },
  }),
  /**
   * Busca un usuario existente por correo para poder asignarle rol (solo `adm`). La cuenta debe existir y estar verificada.
   * No revela cuentas de otros negocios (la plataforma es multi-tenant): solo responde si la cuenta ya es miembro de ESTE
   * negocio o si no pertenece a ningún negocio (claim sin tenants, cuenta libre para asignar). En cualquier otro caso
   * responde exactamente igual que si no existiera, para que no sirva de oráculo de qué correos usa otro negocio.
   */
  buscarUsuarioPorCorreo: accion({
    esquema: objeto({ correo: z.string().email().max(120) }),
    ejecutar: async (c, d) => {
      const noExiste = new HttpsError('not-found', 'No existe una cuenta con ese correo.');
      let u;
      try {
        u = await c.e.auth.getUserByEmail(d.correo);
      } catch (error) {
        if ((error as { code?: unknown }).code === 'auth/user-not-found') throw noExiste;
        throw error;
      }
      const claim = leerClaim(u.customClaims);
      const sinTenants = !claim.ok || Object.keys(claim.valor.pl.t).length === 0;
      const doc = await c.e.firestore.doc(ruta(c.tenantId, 'miembros', u.uid)).get();
      // Un documento solo «invitado» (sin `rol`) no hace miembro: no revela `correoVerificado` ni `conContrasena`.
      const esMiembro = (doc.exists && typeof doc.data()?.['rol'] === 'string') || (claim.ok && Object.hasOwn(claim.valor.pl.t, c.tenantId));
      if (!sinTenants && !esMiembro) throw noExiste;
      return { uid: u.uid, correoVerificado: u.emailVerified, conContrasena: u.providerData.some((p) => p.providerId === 'password') };
    },
  }),
  /**
   * Invita a una persona por correo con un rol reservado (solo `adm` o propietario; la jerarquía la impone el núcleo, que
   * permite al administrador invitar también administradores). El uid del actor sale del token. Respuesta SIEMPRE igual
   * («Invitación enviada»), exista o no la cuenta y pertenezca o no a otro comercio. El correo con el enlace lo envía el panel.
   */
  invitarUsuario: accion({
    esquema: objeto({ correo: z.string().trim().toLowerCase().email().max(120), rol: ROL }),
    ejecutar: async (c, d) => {
      await limitarInvitaciones(c);
      const cuenta = await cuentaParaInvitar(c.e, d.correo);
      const respuesta = { ok: true, mensaje: MENSAJE_INVITACION };
      // Riesgo aceptado: una cuenta sin proveedor de contraseña (o del propietario) recibe la misma respuesta pero no queda invitada
      // ni ocupa cupo; un administrador podría notarlo en su lista. Se acepta: solo lo ve un administrador de este comercio y no
      // revela datos de otro comercio.
      if (cuenta === undefined) return respuesta;
      let r;
      try {
        r = await invitarMiembro(depsInvitar(c.e), c.actor, c.tenantId, cuenta.uid, d.rol as Rol, cuenta.creada);
      } catch (error) {
        // Solo si la cuenta nació en ESTA llamada (y, además, sin invitaciones ni rol: ver `borrarCuentaDeInvitacion`).
        if (cuenta.creada) await borrarCuentaDeInvitacion(c.e, cuenta.uid);
        throw error;
      }
      await borrarCuentas(c.e, r.cuentasCaducadas);
      return respuesta;
    },
  }),
  /** Anula una invitación (solo `adm`): libera el cupo y borra la cuenta de Auth si la creó la invitación y nadie la usó. */
  anularInvitacion: accion({
    esquema: objeto({ uid: UID }),
    ejecutar: async (c, d) => {
      const r = await anularInvitacion(depsInvitar(c.e), c.actor, c.tenantId, d.uid);
      if (r.cuentaCreada) await borrarCuentaDeInvitacion(c.e, d.uid);
      return { ok: true };
    },
  }),
  /** Reenvía una invitación (solo `adm`): extiende 7 días el vencimiento. El panel envía de nuevo el correo. */
  reenviarInvitacion: accion({
    esquema: objeto({ uid: UID }),
    ejecutar: async (c, d) => {
      await limitarInvitaciones(c);
      const r = await reenviarInvitacion(depsInvitar(c.e), c.actor, c.tenantId, d.uid);
      return { ok: true, mensaje: MENSAJE_INVITACION, venceEnMs: r.venceEnMs };
    },
  }),
  asignarRol: accion({
    esquema: objeto({ uid: UID, rol: ROL }),
    ejecutar: async (c, d) => ({ claim: await asignarRol({ auth: c.e.authMin, db: c.e.db, ahora: c.e.ahora }, c.actor, c.tenantId, d.uid, d.rol as Rol) }),
  }),
  quitarRol: accion({
    esquema: objeto({ uid: UID }),
    ejecutar: async (c, d) => ({ claim: await quitarRol({ auth: c.e.authMin, db: c.e.db, ahora: c.e.ahora }, c.actor, c.tenantId, d.uid) }),
  }),
  /**
   * Ids de los módulos efectivos del tenant (L2-6, Central): el panel filtra su menú con ellos. No depende de ningún
   * módulo para poder ejecutarse con todo apagado. Falla cerrado: tenant sin documento o inválido se rechaza.
   */
  modulosActivos: accion({
    esquema: VACIO,
    ejecutar: async (c) => {
      const modulos = await c.e.modulosDelTenant(c.tenantId);
      if (modulos === undefined) throw moduloApagado('Este negocio no está habilitado.');
      return { modulos: [...modulos] };
    },
  }),
  /**
   * Mercados y monedas del comercio de la sesión (Central, solo lectura): el panel arma sus selectores con ellos. Nunca
   * recibe un tenant del cliente. Falla cerrado: si la configuración es inválida, el
   * marco la rechaza antes con 403 `modulo-apagado`; `ComercialInvalida` (`failed-precondition`, `comercial-invalida`) solo
   * aparece si las cachés de módulos y de configuración tienen distinta edad.
   */
  configuracionComercial: accion({
    esquema: VACIO,
    ejecutar: async (c) => vistaComercial(await c.e.comercialDelTenant(c.tenantId), c.rol === 'adm'),
  }),
};

// ---- Activación (callable propio, sin tenant ni rol) ---------------------------------------------------------------
/**
 * Puerto que el coordinador debe sumar al `Entorno`: `limiteActivaciones: LimiteTasa`, de `MAXIMO_ACTIVACIONES_POR_HORA` por
 * `VENTANA_INVITACIONES_MS`, con clave por uid. Mientras no exista, la activación no se limita.
 */
export interface PuertoLimiteActivaciones {
  readonly limiteActivaciones?: LimiteTasa;
}

export interface OpcionesActivacion {
  readonly entorno: () => Entorno;
  readonly appCheckExigido: () => boolean;
}

const BEARER = /^Bearer\s+(\S+)$/i;

/**
 * Manejador del callable `activarInvitaciones` (lo registra el coordinador en `index.ts`): activa las invitaciones del usuario
 * que acaba de entrar. Entrada: ninguna (se ignora todo el cuerpo). El uid sale del token; exige App Check, token vigente y no
 * revocado, proveedor de contraseña y correo verificado (si no: `failed-precondition` con `details.codigo = 'correo-no-verificado'`).
 * Devuelve solo cuántas membresías se activaron; los uid y los comercios no salen.
 */
export function manejadorActivarInvitaciones(o: OpcionesActivacion): (req: CallableRequest) => Promise<unknown> {
  return async (req) => {
    try {
      exigirAppCheck(o.appCheckExigido(), req);
      const h = req.rawRequest.headers['authorization'];
      const m = BEARER.exec((Array.isArray(h) ? h[0] : h) ?? '');
      if (m?.[1] === undefined) throw new HttpsError('unauthenticated', 'Inicie sesión para continuar.');
      const e = o.entorno();
      let claims;
      try {
        claims = await e.auth.verifyIdToken(m[1], true);
      } catch {
        throw new HttpsError('unauthenticated', 'La sesión no es válida o fue revocada. Vuelva a iniciar sesión.');
      }
      if (proveedorDe(claims) !== 'password') throw new HttpsError('permission-denied', 'El personal debe ingresar con correo y contraseña.');
      const limite = (e as PuertoLimiteActivaciones).limiteActivaciones;
      if (limite !== undefined) {
        const t = await limite.intentar(`activar:${claims.uid}`, e.ahora());
        if (!t.permitido) throw new HttpsError('resource-exhausted', 'Demasiados intentos. Intente de nuevo más tarde.', { codigo: 'limite-activaciones', reintentarEnSeg: t.reintentarEnSeg });
      }
      if (claims.email_verified !== true) throw new HttpsError('failed-precondition', 'Verifique su correo para ingresar.', { codigo: 'correo-no-verificado' });
      const r = await activarInvitaciones(depsInvitar(e), claims.uid, true);
      if (r.fallidos.length > 0) logger.warn('activación parcial', { alerta: 'invitaciones', fallidos: r.fallidos.length });
      return { activadas: r.activados.length, sinEfecto: r.sinEfecto.length, fallidas: r.fallidos.length };
    } catch (error) {
      throw comoHttpsError(error, { modulo: 'activarInvitaciones' });
    }
  };
}
