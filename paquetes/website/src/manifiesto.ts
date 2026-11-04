import type { ManifiestoModulo } from '@plataforma/nucleo';

/** Manifiesto del módulo website. Las colecciones se declaran cuando el módulo las construye. */
export const manifiestoWebsite: ManifiestoModulo = {
  id: 'website',
  version: '0.1.0',
  dependeDe: ['nucleo'],
  submodulos: [],
  colecciones: [],
  emite: ['pedido.solicitado'],
  consume: [],
};
