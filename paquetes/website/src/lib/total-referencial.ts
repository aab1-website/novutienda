/**
 * Total referencial del pedido: suma los productos que tienen precio con `vistaPrecio` (la misma función que
 * `Precio.tsx`, que usa `precioFinal` del núcleo y la cotización). Nunca hay una tasa propia aquí.
 * Los productos sin precio («a consultar») no suman: se cuentan aparte para avisar.
 */
import type { Mercado, Redondeo } from '@novutienda/nucleo';
import type { Carrito } from './carrito.js';
import type { CotizacionCliente } from './cotizacion-cliente.js';
import { formatearMonto } from './dinero.js';
import { monedaDe } from './mercado.js';
import { vistaPrecio } from './precio-vista.js';

/** Precio base en USD por mercado de cada producto publicado (0 = consultar). */
export type PreciosProductos = Readonly<Record<string, Readonly<Record<Mercado, number>> | undefined>>;

/** Precio de una línea del pedido, ya formateado como en pantalla; `null` = precio a consultar. */
export interface PrecioLinea {
  readonly id: string;
  readonly unitario: string | null;
  readonly subtotal: string | null;
}

export type TotalReferencial =
  | { readonly tipo: 'total'; readonly texto: string; readonly centavos: number; readonly sinPrecio: number; readonly lineas: readonly PrecioLinea[] }
  /** Ningún producto del pedido tiene precio. */
  | { readonly tipo: 'a_consultar'; readonly sinPrecio: number }
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'sin_cotizacion' };

/**
 * @param cotizacion del mercado elegido; `undefined` = todavía cargando; `null` = no hay una utilizable.
 */
export function totalReferencial(
  carrito: Carrito, precios: PreciosProductos, mercado: Mercado,
  cotizacion: CotizacionCliente | null | undefined, redondeo: Redondeo,
): TotalReferencial {
  let centavos = 0;
  let sinPrecio = 0;
  let conPrecio = 0;
  const lineas: PrecioLinea[] = [];
  const moneda = monedaDe(mercado);
  for (const l of carrito) {
    const v = vistaPrecio(precios[l.id]?.[mercado] ?? 0, mercado, cotizacion, redondeo);
    if (v.tipo === 'consultar') {
      sinPrecio += 1;
      lineas.push({ id: l.id, unitario: null, subtotal: null });
    }
    else if (v.tipo === 'cargando') return { tipo: 'cargando' };
    else if (v.tipo === 'sin_cotizacion') return { tipo: 'sin_cotizacion' };
    else {
      centavos += v.centavos * l.cantidad;
      conPrecio += 1;
      lineas.push({ id: l.id, unitario: v.texto, subtotal: formatearMonto(v.centavos * l.cantidad, moneda) });
    }
  }
  if (conPrecio === 0) return { tipo: 'a_consultar', sinPrecio };
  return { tipo: 'total', texto: formatearMonto(centavos, moneda), centavos, sinPrecio, lineas };
}
