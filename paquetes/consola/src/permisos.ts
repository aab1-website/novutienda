import { rolEn, type Actor, type Rol } from '@plataforma/nucleo';
import { ErrorConsola } from './errores.js';
import { tenantValido } from './rutas.js';

/**
 * Exige que el actor tenga, EN ESE tenant, uno de los roles permitidos. El claim de
 * otro tenant no sirve. Devuelve el rol.
 */
export function exigirRol(actor: Actor, tenantId: string, permitidos: readonly Rol[]): Rol {
  tenantValido(tenantId);
  if (typeof actor.uid !== 'string' || actor.uid === '') throw new ErrorConsola('no-autorizado', 'Sesión inválida');
  const rol = rolEn(actor.claims, tenantId);
  if (rol === '' || !permitidos.includes(rol)) throw new ErrorConsola('no-autorizado', 'No tiene permiso para esta acción');
  return rol;
}

/** Quién puede qué. adm administra todo; sup edita fichas y sube medios; caj no usa la consola. */
export const ROLES = {
  /** Editar fichas, subir y borrar medios. */
  editarFichas: ['sup', 'adm'],
  /** Precios, importación, secciones, apariencia, publicación. */
  administrar: ['adm'],
  /** Ver tablero, uso y exportar. */
  consultar: ['sup', 'adm'],
} as const satisfies Record<string, readonly Rol[]>;
