import type { CopiaCotizacion } from '../tipo-cambio/tipos.js';
import { arreglo, cantidadPositiva, objeto, texto } from './esquema.js';

/** Piezas internas compartidas por los contratos de pedido (no se exportan desde el índice). */

export const esquemaLineasPedido = arreglo(objeto({ productoId: texto, cantidad: cantidadPositiva }), 1);

/**
 * Coherencia entre mercado, moneda y cotización. El evento no ve la configuración del tenant, así que exige lo que
 * se puede comprobar sin ella: la moneda del pedido es uno de los dos lados del par de la cotización (`VENTA/BASE`).
 */
export function errorMercadoMonedaCotizacion(
  d: { readonly mercado: string; readonly moneda: string; readonly cotizacion: CopiaCotizacion<string> },
): string | null {
  const [venta, base] = d.cotizacion.par.split('/');
  if (d.moneda !== venta && d.moneda !== base) return `datos.moneda no corresponde al mercado ${d.mercado}`;
  return null;
}

export const cotizacionArsDePrueba: CopiaCotizacion = {
  cotizacionId: 'AR-2026-11-04-1',
  par: 'ARS/USD',
  valor: 1200,
  fecha: '2026-11-04',
  fuente: 'BNA',
  estado: 'vigente',
};
