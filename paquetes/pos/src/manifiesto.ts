import type { ManifiestoModulo } from '@plataforma/nucleo';

/** Manifiesto del módulo pos. Las colecciones se declaran cuando el módulo las construye. */
export const manifiestoPos: ManifiestoModulo = {
  id: 'pos',
  version: '0.1.0',
  dependeDe: ['nucleo'],
  submodulos: [],
  colecciones: [],
  emite: ['venta.confirmada', 'venta.anulada', 'turno.cerrado'],
  consume: [],
};
