/** Productos relacionados de la ficha: de la misma categoría, sin el propio, hasta 4. Puro, sin DOM. */
import type { Producto } from '../contenido/tipos.js';

export const MAX_RELACIONADOS = 4;

export function relacionados(productos: readonly Producto[], actual: Pick<Producto, 'id' | 'categoria'>, max: number = MAX_RELACIONADOS): readonly Producto[] {
  return productos.filter((p) => p.categoria === actual.categoria && p.id !== actual.id).slice(0, Math.max(0, max));
}
