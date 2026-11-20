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

export type TotalReferencial =
  | { readonly tipo: 'total'; readonly texto: string; readonly centavos: number; readonly sinPrecio: number }
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
  for (const l of carrito) {
    const v = vistaPrecio(precios[l.id]?.[mercado] ?? 0, mercado, cotizacion, redondeo);
    if (v.tipo === 'consultar') sinPrecio += 1;
    else if (v.tipo === 'cargando') return { tipo: 'cargando' };
    else if (v.tipo === 'sin_cotizacion') return { tipo: 'sin_cotizacion' };
    else {
      centavos += v.centavos * l.cantidad;
      conPrecio += 1;
    }
  }
  if (conPrecio === 0) return { tipo: 'a_consultar', sinPrecio };
  return { tipo: 'total', texto: formatearMonto(centavos, monedaDe(mercado)), centavos, sinPrecio };
}
