import type { ManifiestoModulo } from '@novutienda/nucleo';

/**
 * Manifiesto del panel único de gestión. El panel es una SPA cliente: no es dueño de datos, no declara colecciones,
 * no emite ni consume eventos. Todo lo que muestra y escribe pasa por los callables de los demás módulos.
 * Es de zona Central: sus pantallas y acciones las ve todo comercio, tenga los módulos que tenga.
 */
export const manifiestoPanel: ManifiestoModulo = {
  id: 'panel',
  version: '0.1.0',
  zona: 'central',
  dependeDe: ['nucleo'],
  submodulos: [],
  colecciones: [],
  emite: [],
  consume: [],
  pantallas: [
    { id: 'usuarios', titulo: 'Usuarios', orden: 80, roles: ['adm'] },
    { id: 'configuracion', titulo: 'Configuración', orden: 90, roles: ['adm'] },
  ],
  // Las acciones de usuarios viajan en el callable `consola`.
  acciones: [
    { callable: 'consola', nombre: 'listarUsuarios', roles: ['sup', 'adm'], propietario: false },
    { callable: 'consola', nombre: 'buscarUsuarioPorCorreo', roles: ['adm'], propietario: true },
    { callable: 'consola', nombre: 'asignarRol', roles: ['adm'], propietario: true },
    { callable: 'consola', nombre: 'quitarRol', roles: ['adm'], propietario: true },
  ],
};
