import { aCentavos, precioFinal, type Mercado, type Moneda, type Redondeo } from '@novutienda/nucleo';
import type { CotizacionVista } from '../api/tipos.js';

/**
 * Redondeo POR DEFECTO de las decisiones de negocio (04/11/2026): BOB a dos decimales; ARS al múltiplo de 100 más cercano.
 * Es solo el respaldo mientras carga: el redondeo vigente es el que devuelve el servidor (`pos.cotizaciones`), que es el
 * que aplica al cobrar; el POS rechaza (`precio-alterado`) cualquier diferencia.
 */
export const REDONDEO: Redondeo = {
  BOB: { tipo: 'decimales', decimales: 2, modo: 'cercano' },
  ARS: { tipo: 'multiplo', multiplo: 100, modo: 'cercano' },
} as Redondeo;

let redondeoVigente: Redondeo = REDONDEO;

/** Fija el redondeo que devolvió el servidor (política del negocio). Ignora lo que no tenga la forma esperada. */
export function fijarRedondeo(r: unknown): void {
  if (typeof r !== 'object' || r === null) return;
  const o = r as Record<string, unknown>;
  const valida = (x: unknown): boolean => typeof x === 'object' && x !== null && ['ninguno', 'decimales', 'multiplo'].includes(String((x as { tipo?: unknown }).tipo));
  if (valida(o['BOB']) && valida(o['ARS'])) redondeoVigente = r as Redondeo;
}

/** Redondeo en uso: el del servidor si ya llegó; si no, el respaldo por defecto. */
export const redondeoActual = (): Redondeo => redondeoVigente;

/** Vuelve al respaldo por defecto (cambio de negocio o de sesión, y pruebas). */
export const restablecerRedondeo = (): void => {
  redondeoVigente = REDONDEO;
};

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
  const r = precioFinal(usdCentavos / 100, mercado, { par: cotizacion.par, valor: cotizacion.valor }, redondeoVigente);
  if (r.tipo === 'sin_precio') return { tipo: 'sin_precio' };
  if (r.tipo === 'invalido') return { tipo: 'sin_cotizacion' };
  return { tipo: 'precio', centavos: r.centavos, moneda: r.moneda };
}

export { aCentavos };
