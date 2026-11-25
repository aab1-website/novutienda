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
    { id: 'tipoCambio', titulo: 'Tipo de cambio', orden: 85, roles: ['adm'] },
    { id: 'configuracion', titulo: 'Configuración', orden: 90, roles: ['adm'] },
  ],
  // Las acciones de usuarios y `modulosActivos` (Central) viajan en el callable `consola`.
  acciones: [
    { callable: 'consola', nombre: 'listarUsuarios', roles: ['sup', 'adm'], propietario: false },
    { callable: 'consola', nombre: 'buscarUsuarioPorCorreo', roles: ['adm'], propietario: true },
    { callable: 'consola', nombre: 'asignarRol', roles: ['adm'], propietario: true },
    { callable: 'consola', nombre: 'quitarRol', roles: ['adm'], propietario: true },
    // Invitar por correo (U-01): el administrador invita con un rol reservado; la activación va en su propio callable (sin tenant ni rol).
    { callable: 'consola', nombre: 'invitarUsuario', roles: ['adm'], propietario: true },
    { callable: 'consola', nombre: 'anularInvitacion', roles: ['adm'], propietario: true },
    { callable: 'consola', nombre: 'reenviarInvitacion', roles: ['adm'], propietario: true },
    // L2-6: ids de los módulos efectivos del tenant (el panel arma su menú con ellos). Sin propietario: exige rol.
    { callable: 'consola', nombre: 'modulosActivos', roles: ['caj', 'sup', 'adm'], propietario: false },
    // Mercados y monedas del comercio de la sesión (solo lectura): todos los roles necesitan saber en qué monedas se trabaja.
    { callable: 'consola', nombre: 'configuracionComercial', roles: ['caj', 'sup', 'adm'], propietario: false },
    // Tipo de cambio manual (TC-2): ver la referencia y el manual, fijarlo y volver al del banco central. Solo administrador;
    // fijar y quitar admiten administrador con contraseña o propietario, como lo impone el núcleo.
    { callable: 'consola', nombre: 'verTipoCambio', roles: ['adm'], propietario: true },
    { callable: 'consola', nombre: 'cotizacionManual', roles: ['adm'], propietario: true },
    { callable: 'consola', nombre: 'quitarCotizacionManual', roles: ['adm'], propietario: true },
    // Redondeo de precios: el administrador solo lo VE; solo el operador de NovuTienda (propietario, sin rol de comercio) lo FIJA.
    { callable: 'consola', nombre: 'verRedondeo', roles: ['adm'], propietario: true },
    { callable: 'consola', nombre: 'fijarRedondeo', roles: [], propietario: true },
  ],
};
