import type { ColeccionManifiesto, ManifiestoModulo, Rol } from '@plataforma/nucleo';

const TODOS: readonly Rol[] = ['caj', 'sup', 'adm'];
const SUPERVISION: readonly Rol[] = ['sup', 'adm'];

/** Todas las escrituras son del servidor; el navegador solo lee según el rol. */
const col = (ruta: string, lectura: readonly Rol[], limite?: 'productos' | 'almacenes'): ColeccionManifiesto => ({
  ruta,
  lectura,
  escritura: 'servidor',
  ...(limite !== undefined ? { limite } : {}),
});

/** Manifiesto del módulo inventarios (lo registra el coordinador en `plataforma/registro.ts`). */
export const manifiestoInventarios: ManifiestoModulo = {
  id: 'inventarios',
  version: '0.1.0',
  dependeDe: ['nucleo'],
  submodulos: [],
  colecciones: [
    col('productos', TODOS, 'productos'),
    col('costos', ['adm']),
    col('skus', SUPERVISION),
    col('ubicaciones', TODOS, 'almacenes'),
    col('existencias', TODOS),
    col('unidades', TODOS),
    col('movimientos', SUPERVISION),
    col('operaciones', SUPERVISION),
    col('traspasos', SUPERVISION),
    col('mermas', SUPERVISION),
    col('conteos', TODOS),
    col('conteoLineas', TODOS),
    // Los teóricos no los lee quien cuenta.
    col('conteoTeoricos', SUPERVISION),
    // La lee el sitio a través de la API, no el navegador.
    col('existenciasPublicas', []),
  ],
  emite: ['stock.cambiado', 'stock.bajo'],
  // venta.confirmada no se consume: el POS descuenta con el puerto dentro de su propia transacción.
  consume: ['venta.anulada', 'pedido.confirmado'],
};
