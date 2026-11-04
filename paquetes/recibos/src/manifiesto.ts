import type { ManifiestoModulo } from '@novutienda/nucleo';

/**
 * Manifiesto del módulo recibos. Todas las colecciones las escribe solo el servidor y NINGUNA se lee directo desde el navegador
 * (`lectura: []`): el panel no usa Firestore y consulta todo por los callables (docs/arquitectura/decisiones.md, «Lectura solo por callables»).
 */
export const manifiestoRecibos: ManifiestoModulo = {
  id: 'recibos',
  version: '0.1.0',
  dependeDe: ['nucleo'],
  submodulos: [],
  colecciones: [
    { ruta: 'recibos', lectura: [], escritura: 'servidor' },
    { ruta: 'plantillas_recibo', lectura: [], escritura: 'servidor' },
    // Anulaciones llegadas antes que su venta; interno, no lo lee ningún cliente.
    { ruta: 'anulaciones_pendientes_recibo', lectura: [], escritura: 'servidor' },
  ],
  emite: ['recibo.emitido'],
  consume: ['venta.confirmada', 'venta.anulada'],
};
