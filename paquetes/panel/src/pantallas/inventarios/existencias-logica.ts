import type { ProductoPanel, UbicacionId } from '../../api/tipos.js';

/**
 * Lógica pura de «Existencias por almacén». Regla dura: ningún número, conteo de filas, orden, filtro ni estado vacío puede
 * revelar el stock de un almacén oculto. Por eso un almacén oculto devuelve `{ oculto: true }` y nada más: ni filas, ni sumas,
 * ni cantidades. «Oculto» y «vacío» se distinguen solo por la marca del servidor (o por un `null` en ese almacén), jamás por
 * lo que haya en las cifras.
 */

export interface OpcionesFilas {
  /** «Mostrar también los que están en 0». Por omisión, desmarcada. */
  readonly incluirCero?: boolean;
  /** Conteos abiertos de la marca de la lista (la lista que llegó oculta nombra los almacenes en conteo). */
  readonly conteos?: readonly { readonly ubicacionId: string }[];
}

export interface FilaExistencia {
  readonly producto: ProductoPanel;
  readonly cantidad: number;
}

export type ResultadoAlmacen =
  | { readonly oculto: true }
  | { readonly oculto: false; readonly filas: readonly FilaExistencia[]; readonly unidades: number; readonly productos: number };

/** `true` si el almacén está oculto: la marca lo nombra o cualquier producto trae `null` en él. Falla cerrado. */
export function almacenOculto(productos: readonly ProductoPanel[], almacen: UbicacionId, conteos: OpcionesFilas['conteos'] = []): boolean {
  return conteos.some((c) => c.ubicacionId === almacen) || productos.some((p) => p.existencias[almacen] === null);
}

/**
 * Filas de un almacén, ordenadas siempre por nombre. Excluye los inactivos y los que no controlan stock. Sin `incluirCero`
 * deja fuera los que están en 0.
 */
export function filasDeAlmacen(productos: readonly ProductoPanel[], almacen: UbicacionId, opciones: OpcionesFilas = {}): ResultadoAlmacen {
  if (almacenOculto(productos, almacen, opciones.conteos)) return { oculto: true };
  const filas: FilaExistencia[] = [];
  for (const producto of productos) {
    if (!producto.activo) continue;
    const cantidad = producto.existencias[almacen];
    if (typeof cantidad !== 'number') continue;
    if (cantidad === 0 && opciones.incluirCero !== true) continue;
    filas.push({ producto, cantidad });
  }
  filas.sort((a, b) => a.producto.nombre.localeCompare(b.producto.nombre, 'es'));
  return { oculto: false, filas, unidades: filas.reduce((s, f) => s + f.cantidad, 0), productos: filas.length };
}

const plural = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`;

/** «En Tienda: 12 unidades de 3 productos». */
export const encabezadoAlmacen = (nombre: string, unidades: number, productos: number): string =>
  `En ${nombre}: ${plural(unidades, 'unidad', 'unidades')} de ${plural(productos, 'producto', 'productos')}`;

export const mensajeAlmacenOculto = (nombre: string): string => `Las existencias de ${nombre} no se muestran mientras dure el conteo.`;
