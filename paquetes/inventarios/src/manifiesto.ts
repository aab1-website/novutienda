import type { ColeccionManifiesto, ManifiestoModulo, Rol } from '@novutienda/nucleo';

/**
 * Todas las escrituras son del servidor y NINGUNA colección se lee directo desde el navegador (`lectura: []`): el panel no usa
 * Firestore y consulta todo por los callables, que aplican el rol (docs/arquitectura/decisiones.md, «Lectura solo por callables»).
 */
const SIN_LECTURA_DIRECTA: readonly Rol[] = [];

const col = (ruta: string, limite?: 'productos' | 'almacenes'): ColeccionManifiesto => ({
  ruta,
  lectura: SIN_LECTURA_DIRECTA,
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
    col('productos', 'productos'),
    col('costos'),
    col('skus'),
    // El tope de 3 almacenes también se aplica en el código (`crearUbicacion`).
    col('ubicaciones', 'almacenes'),
    col('existencias'),
    col('unidades'),
    col('movimientos'),
    col('operaciones'),
    col('traspasos'),
    col('mermas'),
    col('conteos'),
    col('conteoLineas'),
    // Los teóricos no los lee quien cuenta.
    col('conteoTeoricos'),
    // La lee el sitio a través de la API, no el navegador.
    col('existenciasPublicas'),
  ],
  emite: ['stock.cambiado', 'stock.bajo'],
  // venta.confirmada no se consume: el POS descuenta con el puerto dentro de su propia transacción.
  consume: ['venta.anulada', 'pedido.confirmado'],
};
