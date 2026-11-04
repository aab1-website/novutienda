import type { ManifiestoModulo } from '@plataforma/nucleo';

/** Manifiesto del módulo recibos. Todas las colecciones las escribe solo el servidor. */
export const manifiestoRecibos: ManifiestoModulo = {
  id: 'recibos',
  version: '0.1.0',
  dependeDe: ['nucleo'],
  submodulos: [],
  colecciones: [
    { ruta: 'recibos', lectura: ['caj', 'sup', 'adm'], escritura: 'servidor' },
    { ruta: 'plantillas_recibo', lectura: ['caj', 'sup', 'adm'], escritura: 'servidor' },
    // Contador interno de numeración por serie; no lo lee ningún cliente salvo administración.
    { ruta: 'contadores_recibo', lectura: ['adm'], escritura: 'servidor' },
  ],
  emite: ['recibo.emitido'],
  consume: ['venta.confirmada', 'venta.anulada'],
};
