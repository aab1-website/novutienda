import type { SobreEvento } from '../contratos/sobre-evento.js';
import type { DatosPedidoConfirmadoV1 } from './pedido-confirmado.v1.js';
import type { DatosPedidoConfirmadoV2 } from './pedido-confirmado.v2.js';
import type { DatosPedidoSolicitadoV1 } from './pedido-solicitado.v1.js';
import type { DatosPedidoSolicitadoV2 } from './pedido-solicitado.v2.js';
import type { DatosTurnoCerradoV1 } from './turno-cerrado.v1.js';
import type { DatosTurnoCerradoV2 } from './turno-cerrado.v2.js';
import type { DatosVentaAnuladaV1 } from './venta-anulada.v1.js';
import type { DatosVentaAnuladaV2 } from './venta-anulada.v2.js';
import type { DatosVentaConfirmadaV1 } from './venta-confirmada.v1.js';
import type { DatosVentaConfirmadaV2 } from './venta-confirmada.v2.js';

/** Moneda base de todo evento v1: el precio base del tenant de tres monedas está siempre en dólares. */
const MONEDA_BASE_V1 = 'USD';

/** Tipos que tienen versión 2; los demás no cambian de forma. */
export const TIPOS_CON_V2: readonly string[] = ['venta.confirmada', 'venta.anulada', 'turno.cerrado', 'pedido.solicitado', 'pedido.confirmado'];

/**
 * Lleva los datos de un evento v1 VÁLIDO (ya validado por su contrato) a la forma v2 de su tipo; un consumidor puede así
 * tratar v1 como un caso de v2. Función pura que no valida: la entrada debe haber pasado `validarEvento`.
 *
 * - venta.confirmada: agrega `monedaBase: 'USD'`; la cotización queda igual (`null` si la venta es en USD).
 * - pedido.solicitado y pedido.confirmado: agregan `monedaBase: 'USD'`; en la v1 el pedido siempre trae cotización,
 *   incluso si su moneda es USD, y en la v2 una moneda igual a la base no la lleva: en ese caso la cotización pasa a `null`.
 * - venta.anulada y turno.cerrado: la forma es idéntica (solo se amplía el conjunto de monedas admitidas).
 * - Otro tipo (producto.cambiado, stock.*, recibo.emitido): no tiene v2; se devuelve tal cual.
 */
export function normalizarDatosAV2(tipo: string, datosV1: unknown): unknown {
  switch (tipo) {
    case 'venta.confirmada': {
      const d = datosV1 as DatosVentaConfirmadaV1;
      const v2: DatosVentaConfirmadaV2 = { ...d, monedaBase: MONEDA_BASE_V1 };
      return v2;
    }
    case 'pedido.solicitado': {
      const d = datosV1 as DatosPedidoSolicitadoV1;
      const v2: DatosPedidoSolicitadoV2 = { ...d, monedaBase: MONEDA_BASE_V1, cotizacion: d.moneda === MONEDA_BASE_V1 ? null : d.cotizacion };
      return v2;
    }
    case 'pedido.confirmado': {
      const d = datosV1 as DatosPedidoConfirmadoV1;
      const v2: DatosPedidoConfirmadoV2 = { ...d, monedaBase: MONEDA_BASE_V1, cotizacion: d.moneda === MONEDA_BASE_V1 ? null : d.cotizacion };
      return v2;
    }
    case 'venta.anulada': {
      const v2: DatosVentaAnuladaV2 = datosV1 as DatosVentaAnuladaV1;
      return v2;
    }
    case 'turno.cerrado': {
      const v2: DatosTurnoCerradoV2 = datosV1 as DatosTurnoCerradoV1;
      return v2;
    }
    default:
      return datosV1;
  }
}

/**
 * Lleva un sobre VÁLIDO a la forma v2: uno `version: 1` de un tipo con v2 sale con `version: 2` y datos normalizados;
 * uno que ya es v2, o de un tipo sin v2, sale sin cambios.
 */
export function normalizarEventoAV2(evento: SobreEvento): SobreEvento {
  if (evento.version !== 1 || !TIPOS_CON_V2.includes(evento.tipo)) return evento;
  return { ...evento, version: 2, datos: normalizarDatosAV2(evento.tipo, evento.datos) };
}
