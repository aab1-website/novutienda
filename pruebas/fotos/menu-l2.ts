// Foto del menú del panel (ITEMS_MENU de paquetes/panel/src/util/menu.ts antes de L2-2). El orden es la posición.
export const FOTO_MENU_L2: readonly { readonly id: string; readonly titulo: string; readonly roles: readonly string[] }[] = [
  { id: 'venta', titulo: 'Venta', roles: ['caj', 'sup', 'adm'] },
  { id: 'recibos', titulo: 'Recibos', roles: ['caj', 'sup', 'adm'] },
  { id: 'inventario', titulo: 'Inventario', roles: ['sup', 'adm'] },
  { id: 'mermas', titulo: 'Mermas', roles: ['sup', 'adm'] },
  { id: 'aprobaciones', titulo: 'Aprobaciones', roles: ['sup', 'adm'] },
  { id: 'supervision', titulo: 'Supervisión', roles: ['sup', 'adm'] },
  { id: 'catalogo', titulo: 'Catálogo y sitio', roles: ['sup', 'adm'] },
  { id: 'usuarios', titulo: 'Usuarios', roles: ['adm'] },
  { id: 'configuracion', titulo: 'Configuración', roles: ['adm'] },
];

/** Título que `caj` ve para la pantalla `recibos`. */
export const TITULO_RECIBOS_CAJ = 'Mis recibos';
