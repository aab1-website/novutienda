import type { ManifiestoModulo } from '@plataforma/nucleo';

/**
 * Manifiesto del módulo pos. Todas las colecciones las escribe solo el servidor.
 *
 * Lectura: el manifiesto expresa roles, no propiedad del documento. Para que el vendedor solo vea su
 * turno y sus ventas, `turnos`, `ventas` y el resto de lo operativo se leen solo por `sup` y `adm`; el
 * vendedor obtiene lo suyo por el servidor (callables). `pos_config` (logo, colores, medios) lo leen
 * los tres roles. `contadores/recibo_{serie}` vive en `contadores` (colección del núcleo).
 */
export const manifiestoPos: ManifiestoModulo = {
  id: 'pos',
  version: '0.1.0',
  dependeDe: ['nucleo'],
  submodulos: [],
  colecciones: [
    { ruta: 'pos_config', lectura: ['caj', 'sup', 'adm'], escritura: 'servidor' },
    { ruta: 'turnos', lectura: ['sup', 'adm'], escritura: 'servidor' },
    { ruta: 'ventas', lectura: ['sup', 'adm'], escritura: 'servidor' },
    { ruta: 'anulaciones', lectura: ['sup', 'adm'], escritura: 'servidor' },
    { ruta: 'aprobaciones_descuento', lectura: ['sup', 'adm'], escritura: 'servidor' },
    { ruta: 'movimientos_caja', lectura: ['sup', 'adm'], escritura: 'servidor' },
    { ruta: 'creditos', lectura: ['sup', 'adm'], escritura: 'servidor' },
    { ruta: 'cobros_credito', lectura: ['sup', 'adm'], escritura: 'servidor' },
  ],
  emite: ['venta.confirmada', 'venta.anulada', 'turno.cerrado'],
  consume: [],
};
