import type { ManifiestoModulo } from '@plataforma/nucleo';

/**
 * Manifiesto del panel único de gestión. El panel es una SPA cliente: no es dueño de datos, no declara colecciones,
 * no emite ni consume eventos. Todo lo que muestra y escribe pasa por los callables de los demás módulos.
 */
export const manifiestoPanel: ManifiestoModulo = {
  id: 'panel',
  version: '0.1.0',
  dependeDe: ['nucleo'],
  submodulos: [],
  colecciones: [],
  emite: [],
  consume: [],
};
