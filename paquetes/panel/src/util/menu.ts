import { NO_ENCENDIBLES, type Rol } from '@novutienda/nucleo';
import { PANTALLAS } from './pantallas.generado.js';

export interface ItemMenu {
  readonly id: string;
  readonly titulo: string;
  readonly roles: readonly Rol[];
  /** Módulo dueño de la pantalla (`panel` para las de Central). */
  readonly modulo: string;
  readonly tituloPorRol?: Partial<Record<Rol, string>>;
}

/** Menú por rol (decisión del 04/11/2026), derivado de las pantallas del registro por `orden`. */
export const ITEMS_MENU: readonly ItemMenu[] = [...PANTALLAS]
  .sort((a, b) => a.orden - b.orden)
  .map((p) => ({ id: p.id, titulo: p.titulo, roles: p.roles, modulo: p.modulo, ...(p.tituloPorRol === undefined ? {} : { tituloPorRol: p.tituloPorRol }) }));

/**
 * Módulos efectivos del negocio: la lista que devuelve `modulosActivos`, o `null` mientras no se sabe (aún no cargó o falló).
 * Falla cerrado: con `null` solo se ven las pantallas de Central.
 */
export type ModulosActivos = readonly string[] | null;

const esCentral = (modulo: string): boolean => (NO_ENCENDIBLES as readonly string[]).includes(modulo);

/** Una pantalla es visible para el rol si lo permite y su módulo está encendido (las de Central no dependen de módulos). */
function visible(i: ItemMenu, rol: Rol, modulos: ModulosActivos): boolean {
  return i.roles.includes(rol) && (esCentral(i.modulo) || (modulos !== null && modulos.includes(i.modulo)));
}

export function menuPara(rol: Rol, modulos: ModulosActivos): readonly ItemMenu[] {
  return ITEMS_MENU.filter((i) => visible(i, rol, modulos)).map((i) => ({ ...i, titulo: i.tituloPorRol?.[rol] ?? i.titulo }));
}

/** Ruta por omisión: la primera pantalla visible para el rol y los módulos (`null` si no hay ninguna). */
export function rutaPorOmision(rol: Rol, modulos: ModulosActivos): string | null {
  const primero = menuPara(rol, modulos)[0];
  if (primero === undefined) return null;
  return primero.id === 'venta' ? '#/venta/terminal' : `#/${primero.id}`;
}

export interface Ruta {
  readonly seccion: string;
  readonly sub: string;
}

/** `#/venta/cobro` → { seccion: 'venta', sub: 'cobro' }. */
export function parsearRuta(hash: string): Ruta {
  const [seccion = '', sub = ''] = hash.replace(/^#\/?/, '').split('/');
  return { seccion, sub };
}

export function puedeVer(rol: Rol, seccion: string, modulos: ModulosActivos): boolean {
  return ITEMS_MENU.some((i) => i.id === seccion && visible(i, rol, modulos));
}
