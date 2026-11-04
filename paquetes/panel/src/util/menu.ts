import type { Rol } from '@plataforma/nucleo';

export interface ItemMenu {
  readonly id: string;
  readonly titulo: string;
  readonly roles: readonly Rol[];
}

/** Menú por rol (decisión del 04/11/2026): caj = Venta y Mis recibos; sup agrega Inventario, Mermas, Aprobaciones, Supervisión; adm todo. */
export const ITEMS_MENU: readonly ItemMenu[] = [
  { id: 'venta', titulo: 'Venta', roles: ['caj', 'sup', 'adm'] },
  { id: 'recibos', titulo: 'Recibos', roles: ['caj', 'sup', 'adm'] },
  { id: 'inventario', titulo: 'Inventario', roles: ['sup', 'adm'] },
  { id: 'mermas', titulo: 'Mermas', roles: ['sup', 'adm'] },
  { id: 'aprobaciones', titulo: 'Aprobaciones', roles: ['sup', 'adm'] },
  { id: 'supervision', titulo: 'Supervisión', roles: ['sup', 'adm'] },
  // `sup` edita fichas y medios; el resto del catálogo y el sitio es de `adm`.
  { id: 'catalogo', titulo: 'Catálogo y sitio', roles: ['sup', 'adm'] },
  { id: 'usuarios', titulo: 'Usuarios', roles: ['adm'] },
  { id: 'configuracion', titulo: 'Configuración', roles: ['adm'] },
];

export function menuPara(rol: Rol): readonly (ItemMenu & { titulo: string })[] {
  return ITEMS_MENU.filter((i) => i.roles.includes(rol)).map((i) => (i.id === 'recibos' && rol === 'caj' ? { ...i, titulo: 'Mis recibos' } : i));
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
