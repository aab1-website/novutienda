import type { AccionManifiesto, ManifiestoModulo, Rol } from '@novutienda/nucleo';

const accion = (callable: string, nombre: string, roles: readonly Rol[]): AccionManifiesto => ({ callable, nombre, roles });

const ACCIONES_POS: readonly (readonly [string, readonly Rol[]])[] = [
  ['abrirTurno', ['caj', 'sup', 'adm']],
  ['cerrarTurno', ['caj', 'sup', 'adm']],
  ['cerrarTurnoForzado', ['adm']],
  ['confirmarVenta', ['caj', 'sup', 'adm']],
  ['solicitarAprobacion', ['caj', 'sup', 'adm']],
  ['resolverAprobacion', ['sup', 'adm']],
  ['solicitarAnulacion', ['caj', 'sup', 'adm']],
  ['aprobarAnulacion', ['sup', 'adm']],
  ['registrarMovimientoCaja', ['caj', 'sup', 'adm']],
  ['cobrarCredito', ['caj', 'sup', 'adm']],
  ['leerConfig', ['caj', 'sup', 'adm']],
  ['guardarConfig', ['adm']],
  ['miTurno', ['caj', 'sup', 'adm']],
  ['misVentas', ['caj', 'sup', 'adm']],
  ['venta', ['caj', 'sup', 'adm']],
  ['aprobaciones', ['caj', 'sup', 'adm']],
  ['aprobacion', ['caj', 'sup', 'adm']],
  ['movimientosCaja', ['caj', 'sup', 'adm']],
  ['creditos', ['caj', 'sup', 'adm']],
  ['cotizaciones', ['caj', 'sup', 'adm']],
  ['supervision', ['sup', 'adm']],
  ['turnos', ['sup', 'adm']],
  ['exportarVentasCsv', ['sup', 'adm']],
  ['exportarMovimientosCajaCsv', ['sup', 'adm']],
];

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
  dependeDe: ['nucleo', 'recibos'],
  zona: 'modulo',
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
  acciones: ACCIONES_POS.map(([nombre, roles]) => accion('pos', nombre, roles)),
  pantallas: [
    { id: 'venta', titulo: 'Venta', roles: ['caj', 'sup', 'adm'], orden: 10 },
    { id: 'aprobaciones', titulo: 'Aprobaciones', roles: ['sup', 'adm'], orden: 50 },
    { id: 'supervision', titulo: 'Supervisión', roles: ['sup', 'adm'], orden: 60 },
  ],
  requiere: ['inventarios'],
};
