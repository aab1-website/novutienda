// Marco común de los callables. Cada módulo se expone como UN callable (`pos`, `inventarios`, `consola`,
// `recibos`, `medios`) que recibe `{ accion, tenantId, datos }` y despacha por una tabla de acciones. Cada
// acción declara los roles que pueden invocarla y un esquema estricto de `datos`; el marco hace, en este orden:
// App Check → token (checkRevoked + email_verified) → tenant y rol del claim → esquema → ejecución → traducción
// del error. Los módulos vuelven a validar y a exigir permisos por su cuenta (defensa en profundidad).
import { logger } from 'firebase-functions';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import type { Actor, Rol } from '@novutienda/nucleo';
import type { ActorPos } from '@novutienda/pos';
import { traducirError } from '../../../adaptadores/firebase/index.js';
import { autenticar, exigirAppCheck, personalDelTenant, type Sesion, type SesionTenant } from '../autenticacion.js';
import type { Entorno } from '../entorno.js';
import { RedondeoInvalido } from '../redondeo.js';
import { aJson } from '../serializar.js';

export interface Contexto {
  readonly e: Entorno;
  readonly tenantId: string;
  readonly sesion: Sesion;
  /** Rol del claim en este tenant (`undefined` solo para el propietario de la plataforma sin rol en el tenant). */
  readonly rol: Rol | undefined;
  readonly actor: Actor;
}

/** Actor del POS/Inventarios: exige rol (las acciones que lo usan no admiten al propietario sin rol). */
export function actorPos(c: Contexto): ActorPos {
  if (c.rol === undefined) throw new HttpsError('permission-denied', 'No tiene permiso en este negocio.');
  return { uid: c.sesion.uid, rol: c.rol };
}

export interface DefAccion<E extends z.ZodType> {
  /** Roles del tenant que pueden invocarla. */
  readonly roles: readonly Rol[];
  /** Admite también al propietario de la plataforma (sesión con Google) sin rol en el tenant. */
  readonly propietario?: boolean;
  readonly esquema: E;
  /** Tope del JSON de `datos` en caracteres (por defecto 64 000). */
  readonly maxCaracteres?: number;
  ejecutar(c: Contexto, d: z.infer<E>): Promise<unknown>;
}

export interface Accion {
  readonly roles: readonly Rol[];
  readonly propietario: boolean;
  readonly maxCaracteres: number;
  ejecutar(c: Contexto, crudo: unknown): Promise<unknown>;
}

export const MAX_CARACTERES_POR_DEFECTO = 64_000;

export function accion<E extends z.ZodType>(def: DefAccion<E>): Accion {
  return {
    roles: def.roles,
    propietario: def.propietario === true,
    maxCaracteres: def.maxCaracteres ?? MAX_CARACTERES_POR_DEFECTO,
    ejecutar: (c, crudo) => {
      const r = def.esquema.safeParse(crudo ?? {});
      if (!r.success) {
        // Solo rutas y tipos esperados: nunca se devuelve el valor recibido.
        const campos = r.error.issues.slice(0, 10).map((i) => `${i.path.join('.') || 'datos'}: ${i.message}`);
        throw new HttpsError('invalid-argument', 'Los datos enviados no son válidos.', { campos });
      }
      return def.ejecutar(c, r.data);
    },
  };
}

export type TablaAcciones = Readonly<Record<string, Accion>>;

const envoltura = z.object({ accion: z.string().min(1).max(60), tenantId: z.string().min(1).max(63), datos: z.unknown().optional() }).strict();

export interface OpcionesManejador {
  readonly modulo: string;
  readonly acciones: TablaAcciones;
  readonly entorno: () => Entorno;
  readonly appCheckExigido: () => boolean;
}

/** Convierte cualquier error en `HttpsError` y registra los internos (sin datos de la petición). */
export function comoHttpsError(error: unknown, contexto: Readonly<Record<string, unknown>>): HttpsError {
  if (error instanceof HttpsError) return error;
  if (error instanceof RedondeoInvalido) return new HttpsError('failed-precondition', error.message);
  const t = traducirError(error);
  if (t.interno) logger.error('error interno en callable', { ...contexto, error: error instanceof Error ? { nombre: error.name, mensaje: error.message } : String(error) });
  else logger.warn('callable rechazado', { ...contexto, codigo: t.code });
  return new HttpsError(t.code, t.message, t.details);
}

export function crearManejador(o: OpcionesManejador): (req: CallableRequest) => Promise<unknown> {
  return async (req) => {
    const marca: Record<string, unknown> = { modulo: o.modulo };
    try {
      exigirAppCheck(o.appCheckExigido(), req);
      const sobre = envoltura.safeParse(req.data);
      if (!sobre.success) throw new HttpsError('invalid-argument', 'La petición debe traer accion y tenantId.');
      const { accion: nombre, tenantId, datos } = sobre.data;
      marca['accion'] = nombre;
      marca['tenantId'] = tenantId;
      const def = Object.hasOwn(o.acciones, nombre) ? o.acciones[nombre] : undefined;
      if (def === undefined) throw new HttpsError('invalid-argument', 'Acción desconocida.');
      const e = o.entorno();
      const sesion = await autenticar(e, req);
      marca['uid'] = sesion.uid;
      let rol: Rol | undefined;
      let tenantSesion: SesionTenant | undefined;
      try {
        tenantSesion = personalDelTenant(sesion, tenantId);
        rol = tenantSesion.rol;
      } catch (error) {
        // Sin rol en este tenant: solo pasa el propietario de la plataforma en las acciones que lo admiten.
        if (!(def.propietario && sesion.propietario)) throw error;
      }
      if (rol !== undefined && !def.roles.includes(rol) && !(def.propietario && sesion.propietario)) {
        throw new HttpsError('permission-denied', 'Su rol no permite esta acción.');
      }
      if (datos !== undefined && JSON.stringify(datos).length > def.maxCaracteres) {
        throw new HttpsError('invalid-argument', 'La petición es demasiado grande.');
      }
      const resultado = await def.ejecutar({ e, tenantId, sesion, rol, actor: { uid: sesion.uid, claims: sesion.claims } }, datos);
      return aJson(resultado ?? { ok: true });
    } catch (error) {
      throw comoHttpsError(error, marca);
    }
  };
}
