import type { Carrito } from './carrito.js';
import type { TotalReferencial } from './total-referencial.js';
import { enlaceWhatsApp, mensajeDePedido } from './whatsapp.js';

/**
 * Enlace de WhatsApp de un pedido según el estado de la carga de precios (`usePedido`):
 *  - `cargando`: los precios aún no llegaron y no fallaron; no se debe enviar nada (nunca un mensaje sin montos «en silencio»).
 *  - `listo`: con total, el mensaje lleva precios; si la carga falló (`fallo`), degrada al mensaje sin montos (aceptado).
 * `enlace` es `null` si el negocio no tiene número.
 */
export type EnlacePedido = { readonly estado: 'cargando' } | { readonly estado: 'listo'; readonly enlace: string | null };

export function enlaceSegunPrecios(whatsapp: string | null, carrito: Carrito, t: TotalReferencial | null, fallo: boolean): EnlacePedido {
  if (t === null && !fallo) return { estado: 'cargando' };
  return { estado: 'listo', enlace: enlaceWhatsApp(whatsapp, mensajeDePedido(carrito, t)) };
}
