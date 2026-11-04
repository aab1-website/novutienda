import type { ManifiestoModulo } from '@plataforma/nucleo';

/** Manifiesto del módulo inventarios. Las colecciones se declaran cuando el módulo las construye. */
export const manifiestoInventarios: ManifiestoModulo = {
  id: 'inventarios',
  version: '0.1.0',
  dependeDe: ['nucleo'],
  submodulos: [],
  colecciones: [],
  emite: ['stock.cambiado', 'stock.bajo'],
  consume: ['venta.confirmada', 'venta.anulada', 'pedido.confirmado'],
};
