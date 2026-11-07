import type { Rol } from '@novutienda/nucleo';
import { PANTALLAS } from './pantallas.generado.js';

export interface ItemMenu {
  readonly id: string;
  readonly titulo: string;
  readonly roles: readonly Rol[];
  readonly tituloPorRol?: Partial<Record<Rol, string>>;
}

/** Menú por rol (decisión del 04/11/2026), derivado de las pantallas del registro por `orden`. */
export const ITEMS_MENU: readonly ItemMenu[] = [...PANTALLAS]
  .sort((a, b) => a.orden - b.orden)
  .map((p) => ({ id: p.id, titulo: p.titulo, roles: p.roles, ...(p.tituloPorRol === undefined ? {} : { tituloPorRol: p.tituloPorRol }) }));

export function menuPara(rol: Rol): readonly ItemMenu[] {
  return ITEMS_MENU.filter((i) => i.roles.includes(rol)).map((i) => ({ ...i, titulo: i.tituloPorRol?.[rol] ?? i.titulo }));
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

export function puedeVer(rol: Rol, seccion: string): boolean {
  return ITEMS_MENU.some((i) => i.id === seccion && i.roles.includes(rol));
}
