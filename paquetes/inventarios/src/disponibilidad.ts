import { createHash } from 'node:crypto';

/**
 * Regla ÚNICA de disponibilidad pública (la usan `existenciasPublicas` y, por el puerto del catálogo, la consola):
 * un producto está disponible si está activo y su existencia en el almacén `tienda` es mayor que cero. Los pedidos de
 * WhatsApp descuentan siempre de `tienda`; el stock de los depósitos llega a la tienda por traspaso, así que no cuenta.
 * Un producto que no controla stock (sin `stockTotal`) figura disponible mientras esté activo. Nunca se publican cantidades.
 */
export const UBICACION_DISPONIBILIDAD = 'tienda';

export function esDisponible(producto: { readonly activo: boolean; readonly stockTotal?: number }, existenciaTienda: number): boolean {
  if (!producto.activo) return false;
  if (producto.stockTotal === undefined) return true;
  return existenciaTienda > 0;
}

/**
 * SKU determinista cuando quien da de alta (la consola) no lo informa: el id del producto si cabe en 40 caracteres;
 * si no, los primeros 31 caracteres del id, un guion y 8 caracteres del SHA-256 del id.
 */
export function skuDesdeId(productoId: string): string {
  if (productoId.length <= 40) return productoId;
  return `${productoId.slice(0, 31)}-${createHash('sha256').update(productoId).digest('hex').slice(0, 8)}`;
}
