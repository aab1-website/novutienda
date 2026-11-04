import type { ManifiestoModulo } from '@plataforma/nucleo';

/** Manifiesto del módulo recibos. Las colecciones se declaran cuando el módulo las construye. */
export const manifiestoRecibos: ManifiestoModulo = {
  id: 'recibos',
  version: '0.1.0',
  dependeDe: ['nucleo'],
  submodulos: [],
  colecciones: [],
  emite: ['recibo.emitido'],
  consume: ['venta.confirmada', 'venta.anulada'],
};
