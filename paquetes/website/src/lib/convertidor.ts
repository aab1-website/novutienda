/** Convertidor de referencia: pivote USD con la cotización oficial de cada mercado. */
import type { Cotizaciones } from './cotizacion-cliente.js';

export type MonedaConv = 'USD' | 'BOB' | 'ARS';
export type Conversion = Readonly<Record<MonedaConv, number | null>>;

/** Devuelve el monto en las tres monedas; una moneda sin cotización queda en null. */
export function convertir(desde: MonedaConv, monto: number, cot: Cotizaciones): Conversion {
  const bob = cot.BO?.valor ?? null;
  const ars = cot.AR?.valor ?? null;
  let usd: number | null;
  if (desde === 'USD') usd = monto;
  else if (desde === 'BOB') usd = bob === null ? null : monto / bob;
  else usd = ars === null ? null : monto / ars;
  if (usd === null) return { USD: null, BOB: desde === 'BOB' ? monto : null, ARS: desde === 'ARS' ? monto : null };
  return { USD: usd, BOB: bob === null ? null : usd * bob, ARS: ars === null ? null : usd * ars };
}

/** Presenta un monto de referencia con dos decimales como máximo. */
export function textoReferencia(n: number | null): string {
  if (n === null) return '';
  return (Math.round(n * 100) / 100).toLocaleString('es-BO', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
}
