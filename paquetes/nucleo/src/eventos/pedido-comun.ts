import { MONEDA_DE, PAR_DE, type CopiaCotizacion, type Mercado } from '../tipo-cambio/tipos.js';
import { arreglo, cantidadPositiva, objeto, texto } from './esquema.js';

/** Piezas internas compartidas por los contratos de pedido (no se exportan desde el índice). */

export const esquemaLineasPedido = arreglo(objeto({ productoId: texto, cantidad: cantidadPositiva }), 1);

/** Coherencia entre mercado, moneda y cotización. */
export function errorMercadoMonedaCotizacion(
  d: { readonly mercado: Mercado; readonly moneda: string; readonly cotizacion: CopiaCotizacion },
): string | null {
  if (d.moneda !== 'USD' && d.moneda !== MONEDA_DE[d.mercado]) return `datos.moneda no corresponde al mercado ${d.mercado}`;
  if (d.cotizacion.par !== PAR_DE[d.mercado]) return `datos.cotizacion.par no corresponde al mercado ${d.mercado}`;
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
