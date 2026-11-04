import type { ManifiestoModulo } from '@plataforma/nucleo';

/** Manifiesto del módulo consola (administración del catálogo y del sitio). */
export const manifiestoConsola: ManifiestoModulo = {
  id: 'consola',
  version: '0.1.0',
  dependeDe: ['nucleo'],
  submodulos: [],
  colecciones: [],
  emite: [],
  consume: [],
};
