/** Qué se muestra en lugar del precio. Usa `precioFinal` del núcleo: la misma función que el servidor. */
import { precioFinal, type Mercado, type Redondeo } from '@novutienda/nucleo';
import { formatearMonto } from './dinero.js';
import type { CotizacionCliente } from './cotizacion-cliente.js';

export type VistaPrecio =
  | { readonly tipo: 'consultar' }
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'sin_cotizacion' }
  | { readonly tipo: 'precio'; readonly texto: string; readonly centavos: number; readonly aviso: string | null };

/**
 * @param cotizacion cotización del mercado; `undefined` = todavía cargando; `null` = no hay una utilizable.
 */
export function vistaPrecio(
  usd: number, mercado: Mercado, cotizacion: CotizacionCliente | null | undefined, redondeo: Redondeo,
): VistaPrecio {
  if (usd === 0) return { tipo: 'consultar' };
  if (cotizacion === undefined) return { tipo: 'cargando' };
  if (cotizacion === null) return { tipo: 'sin_cotizacion' };
  const r = precioFinal(usd, mercado, { par: cotizacion.par, valor: cotizacion.valor }, redondeo);
  if (r.tipo === 'sin_precio') return { tipo: 'consultar' };
  if (r.tipo === 'invalido') return { tipo: 'sin_cotizacion' };
  return {
    tipo: 'precio',
    texto: formatearMonto(r.centavos, r.moneda),
    centavos: r.centavos,
    aviso: cotizacion.estado === 'ultimo_verificado' ? `Último valor verificado del ${cotizacion.fecha}` : null,
  };
}

/** Precio en moneda local (para filtrar), o null si no hay precio. */
export function precioLocal(usd: number, mercado: Mercado, cotizacion: CotizacionCliente | null | undefined, redondeo: Redondeo): number | null {
  const v = vistaPrecio(usd, mercado, cotizacion, redondeo);
  return v.tipo === 'precio' ? v.centavos / 100 : null;
}
