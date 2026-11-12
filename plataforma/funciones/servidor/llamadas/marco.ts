// Marco común de los callables. Cada módulo se expone como UN callable (`pos`, `inventarios`, `consola`,
// `recibos`, `medios`) que recibe `{ accion, tenantId, datos }` y despacha por una tabla de acciones. Cada
// acción declara un esquema estricto de `datos`; los roles y el permiso del propietario salen del manifiesto
// (`plataforma/coordinador/encendido.ts`: `tablaDeCallable`). El marco hace, en este orden:
// App Check → token (checkRevoked + email_verified) → tenant y rol del claim → módulo encendido (L2-6) → esquema → ejecución → traducción
// del error. Los módulos vuelven a validar y a exigir permisos por su cuenta (defensa en profundidad).
import { logger } from 'firebase-functions';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import type { Actor, ActorConRol, Rol } from '@novutienda/nucleo';
import { CODIGO_DE_BORDE, CODIGO_MODULO_APAGADO, traducirError } from '../../../conectores/firebase/index.js';
import { recortarDetallesDeStock } from '../../../coordinador/index.js';
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
export function actorPos(c: Contexto): ActorConRol {
  if (c.rol === undefined) throw new HttpsError('permission-denied', 'No tiene permiso en este negocio.');
  return { uid: c.sesion.uid, rol: c.rol };
}

export interface DefAccion<E extends z.ZodType> {
  readonly esquema: E;
  /** Tope del JSON de `datos` en caracteres (por defecto 64 000). */
  readonly maxCaracteres?: number;
  ejecutar(c: Contexto, d: z.infer<E>): Promise<unknown>;
}

/** Implementación de una acción: esquema y ejecución. No lleva permisos: los declara el manifiesto del módulo. */
export interface Implementacion {
  readonly maxCaracteres: number;
  ejecutar(c: Contexto, crudo: unknown): Promise<unknown>;
}

/** Implementación más los permisos que `tablaDeCallable` toma del registro. */
export interface Accion extends Implementacion {
  /** Roles del tenant que pueden invocarla. */
  readonly roles: readonly Rol[];
  /** Admite también al propietario de la plataforma (sesión con Google) sin rol en el tenant. */
  readonly propietario: boolean;
  /** Módulo dueño de la acción. */
  readonly modulo: string;
  /** Si es `true`, el dueño debe estar encendido para el tenant (L2-6); las de Central y núcleo no dependen de módulos. */
  readonly requiereEncendido: boolean;
}

/** Rechazo por módulo apagado (o tenant inexistente): mismo error en ambos casos, para no revelar cuáles tenants existen. */
export function moduloApagado(mensaje = 'Este módulo no está habilitado para su negocio.'): HttpsError {
  return new HttpsError('permission-denied', mensaje, { codigo: CODIGO_MODULO_APAGADO });
}

export const MAX_CARACTERES_POR_DEFECTO = 64_000;

export function accion<E extends z.ZodType>(def: DefAccion<E>): Implementacion {
  return {
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

/** Implementaciones de un borde, por nombre de acción (sin permisos). */
export type TablaImplementaciones = Readonly<Record<string, Implementacion>>;
/** Tabla final de un callable: implementaciones con los permisos del registro. */
export type TablaAcciones = Readonly<Record<string, Accion>>;

const envoltura = z.object({ accion: z.string().min(1).max(60), tenantId: z.string().min(1).max(63), datos: z.unknown().optional() }).strict();

export interface OpcionesManejador {
  readonly modulo: string;
  readonly acciones: TablaAcciones;
  readonly entorno: () => Entorno;
  readonly appCheckExigido: () => boolean;
}

/** Garantiza `details.codigo` en un `HttpsError` nacido en el borde (marco, autenticación, acciones). */
function conCodigo(error: HttpsError, codigoPorDefecto?: string): HttpsError {
  const previo = error.details;
  const objeto = typeof previo === 'object' && previo !== null && !Array.isArray(previo) ? (previo as Record<string, unknown>) : {};
  if (typeof objeto['codigo'] === 'string') return error;
  const base = CODIGO_DE_BORDE[error.code as keyof typeof CODIGO_DE_BORDE] as string | undefined;
  return new HttpsError(error.code, error.message, { ...objeto, codigo: codigoPorDefecto ?? base ?? 'error-interno' });
}

/**
 * Convierte cualquier error en `HttpsError` y registra los internos (sin datos de la petición). Todo `HttpsError`
 * sale con `details.codigo` (código del módulo en kebab-case), para que el panel mapee el mensaje por código.
 */
export function comoHttpsError(error: unknown, contexto: Readonly<Record<string, unknown>>): HttpsError {
  if (error instanceof HttpsError) return conCodigo(error);
  if (error instanceof RedondeoInvalido) return conCodigo(new HttpsError('failed-precondition', error.message), 'redondeo-invalido');
  const t = traducirError(error);
  if (t.interno) logger.error('error interno en callable', { ...contexto, error: error instanceof Error ? { nombre: error.name, mensaje: error.message } : String(error) });
  else logger.warn('callable rechazado', { ...contexto, codigo: t.code });
  return new HttpsError(t.code, t.message, t.details);
}

export function crearManejador(o: OpcionesManejador): (req: CallableRequest) => Promise<unknown> {
  return async (req) => {
    const marca: Record<string, unknown> = { modulo: o.modulo };
    // Para el recorte del error de stock insuficiente (existencias ocultas durante un conteo): se fijan al autenticar.
    let tenantDelError: string | undefined;
    let rolDelError: Rol | undefined;
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
      tenantDelError = tenantId;
      const sesion = await autenticar(e, req);
      marca['uid'] = sesion.uid;
      let rol: Rol | undefined;
      let tenantSesion: SesionTenant | undefined;
      try {
        tenantSesion = personalDelTenant(sesion, tenantId);
        rol = tenantSesion.rol;
        rolDelError = rol;
      } catch (error) {
        // Sin rol en este tenant: solo pasa el propietario de la plataforma en las acciones que lo admiten.
        if (!(def.propietario && sesion.propietario)) throw error;
      }
      if (rol !== undefined && !def.roles.includes(rol) && !(def.propietario && sesion.propietario)) {
        throw new HttpsError('permission-denied', 'Su rol no permite esta acción.');
      }
      // Falla cerrado: tenant sin documento, inválido, de baja o suspendido y módulo apagado se rechazan igual, con el
      // mismo código. Única excepción (D3): el propietario en una acción que lo declara pasa ante un tenant SUSPENDIDO.
      const activos = await e.modulosDelTenant(tenantId);
      if (activos === undefined) {
        const r = def.propietario && sesion.propietario ? await e.estadoModulosDelTenant(tenantId) : undefined;
        if (r === undefined || !('motivo' in r) || r.motivo !== 'suspendido') throw moduloApagado();
        if (def.requiereEncendido && !(r.modulosSiOpera ?? []).includes(def.modulo)) throw moduloApagado();
      } else if (def.requiereEncendido && !activos.includes(def.modulo)) {
        throw moduloApagado();
      }
      if (datos !== undefined && JSON.stringify(datos).length > def.maxCaracteres) {
        throw new HttpsError('invalid-argument', 'La petición es demasiado grande.');
      }
      const resultado = await def.ejecutar({ e, tenantId, sesion, rol, actor: { uid: sesion.uid, claims: sesion.claims } }, datos);
      return aJson(resultado ?? { ok: true });
    } catch (error) {
      const h = comoHttpsError(error, marca);
      // Único punto por donde pasan los callables: quien no es `adm` no recibe `disponible` de un almacén en conteo. Solo se lee
      // (conteos del tenant) cuando el error es de stock insuficiente. Sin rol verificado (falló antes) no hay faltantes que recortar.
      const d = h.details as { codigo?: unknown } | undefined;
      if (d?.codigo === 'stock-insuficiente' && tenantDelError !== undefined) {
        throw new HttpsError(h.code, h.message, await recortarDetallesDeStock(o.entorno().firestore, tenantDelError, rolDelError, h.details));
      }
      throw h;
    }
  };
}
