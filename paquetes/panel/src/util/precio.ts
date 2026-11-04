import { aCentavos, precioFinal, type Mercado, type Moneda, type Redondeo } from '@novutienda/nucleo';
import type { CotizacionVista } from '../api/tipos.js';

/**
 * Redondeo de las decisiones de negocio (04/11/2026): BOB a dos decimales; ARS al múltiplo de 100 más cercano. Debe
 * coincidir con el que inyecta el servidor al POS; el POS rechaza (`precio-alterado`) cualquier diferencia.
 */
export const REDONDEO: Redondeo = {
  BOB: { tipo: 'decimales', decimales: 2, modo: 'cercano' },
  ARS: { tipo: 'multiplo', multiplo: 100, modo: 'cercano' },
} as Redondeo;

export const MONEDA_DE_MERCADO: Readonly<Record<Mercado, Moneda>> = { BO: 'BOB', AR: 'ARS' };

export type PrecioVista =
  | { readonly tipo: 'precio'; readonly centavos: number; readonly moneda: Moneda }
  | { readonly tipo: 'sin_precio' }
  | { readonly tipo: 'sin_cotizacion' };

/**
 * Precio de venta en la moneda elegida. USD: el precio base en centavos. BOB/ARS: `precioFinal` del núcleo (la misma
 * función del sitio y del servidor) con la cotización vigente del mercado.
 */
export function precioDeVenta(usdCentavos: number, mercado: Mercado, moneda: Moneda, cotizacion: CotizacionVista | null): PrecioVista {
  if (usdCentavos <= 0) return { tipo: 'sin_precio' };
  if (moneda === 'USD') return { tipo: 'precio', centavos: usdCentavos, moneda };
  if (cotizacion === null) return { tipo: 'sin_cotizacion' };
  const r = precioFinal(usdCentavos / 100, mercado, { par: cotizacion.par, valor: cotizacion.valor }, REDONDEO);
  if (r.tipo === 'sin_precio') return { tipo: 'sin_precio' };
  if (r.tipo === 'invalido') return { tipo: 'sin_cotizacion' };
  return { tipo: 'precio', centavos: r.centavos, moneda: r.moneda };
}

export { aCentavos };
