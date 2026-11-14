import type { Resultado } from '../contratos/claim.js';
import type { SobreEvento } from '../contratos/sobre-evento.js';
import type { ConfiguracionComercial } from '../tenant/mercados.js';
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

/** Lo que la normalización necesita de fuera: la configuración del tenant y, si hace falta, el mercado de la venta. */
export interface ContextoNormalizacion {
  readonly comercial: ConfiguracionComercial;
  /** Mercado explícito de una venta v1; obligatorio cuando la configuración no lo determina sin ambigüedad. */
  readonly mercado?: string;
}

/**
 * Mercados en que pudo ocurrir una venta v1: los de moneda base USD (la v1 siempre guarda el precio en dólares) cuya
 * moneda de venta es la de la venta; una venta en la moneda base (USD) pudo ocurrir en cualquiera de ellos.
 */
function mercadosPosibles(comercial: ConfiguracionComercial, moneda: string): readonly string[] {
  return comercial.mercados
    .filter((m) => m.monedaBase === MONEDA_BASE_V1 && (moneda === MONEDA_BASE_V1 || m.monedaVenta === moneda))
    .map((m) => m.id);
}

/** Decide el mercado de una venta v1: explícito si lo hay (y debe ser posible), deducido si es único, error si no. */
function mercadoDeVentaV1(moneda: string, contexto: ContextoNormalizacion | undefined): Resultado<string> {
  if (contexto === undefined) return { ok: false, error: 'La venta v1 necesita la configuración comercial del tenant para llevarse a v2 (no se deduce el mercado)' };
  const posibles = mercadosPosibles(contexto.comercial, moneda);
  if (contexto.mercado !== undefined) {
    return posibles.includes(contexto.mercado)
      ? { ok: true, valor: contexto.mercado }
      : { ok: false, error: `El mercado ${contexto.mercado} no puede ser el de una venta v1 en ${moneda}` };
  }
  const [unico] = posibles;
  if (posibles.length === 1 && unico !== undefined) return { ok: true, valor: unico };
  return {
    ok: false,
    error: posibles.length === 0
      ? `Ningún mercado del tenant admite una venta v1 en ${moneda}`
      : `La venta v1 en ${moneda} es ambigua entre los mercados ${posibles.join(', ')}: pase el mercado explícito`,
  };
}

/**
 * Lleva los datos de un evento v1 VÁLIDO (ya validado por su contrato) a la forma v2 de su tipo; un consumidor puede así
 * tratar v1 como un caso de v2. Función pura que no valida los datos: la entrada debe haber pasado `validarEvento`.
 * La normalización es una VISTA DE LECTURA: los eventos v1 se siguen guardando como v1 y nada se reescribe.
 *
 * - venta.confirmada: agrega `monedaBase: 'USD'` y `mercado`. El mercado se deduce de la configuración cuando la moneda lo
 *   determina sin ambigüedad (BOB o ARS con un solo mercado que venda en ella); si es ambiguo (venta en USD, la moneda
 *   base compartida) quien llama DEBE pasar `contexto.mercado`, y sin él falla cerrado (`ok: false`), igual que
 *   sin `contexto`. La cotización queda igual (`null` si la venta es en USD).
 * - pedido.solicitado y pedido.confirmado: agregan `monedaBase: 'USD'`; el pedido v1 ya trae su mercado, así que no hay
 *   nada que deducir ni contexto que pasar. En la v1 el pedido siempre trae cotización, incluso si su moneda es USD, y
 *   en la v2 una moneda igual a la base no la lleva: en ese caso la cotización pasa a `null`.
 *   PÉRDIDA ACEPTADA: un pedido v1 en la moneda base pierde la cotización de referencia que guardaba la v1 (el
 *   original v1 sigue guardado con ella; solo la vista v2 no la muestra).
 * - venta.anulada y turno.cerrado: la forma es idéntica (solo se amplía el conjunto de monedas admitidas).
 * - Otro tipo (producto.cambiado, stock.*, recibo.emitido): no tiene v2; se devuelve tal cual.
 */
export function normalizarDatosAV2(tipo: string, datosV1: unknown, contexto?: ContextoNormalizacion): Resultado<unknown> {
  switch (tipo) {
    case 'venta.confirmada': {
      const d = datosV1 as DatosVentaConfirmadaV1;
      const mercado = mercadoDeVentaV1(d.moneda, contexto);
      if (!mercado.ok) return mercado;
      const v2: DatosVentaConfirmadaV2 = { ...d, mercado: mercado.valor, monedaBase: MONEDA_BASE_V1 };
      return { ok: true, valor: v2 };
    }
    case 'pedido.solicitado': {
      const d = datosV1 as DatosPedidoSolicitadoV1;
      const v2: DatosPedidoSolicitadoV2 = { ...d, monedaBase: MONEDA_BASE_V1, cotizacion: d.moneda === MONEDA_BASE_V1 ? null : d.cotizacion };
      return { ok: true, valor: v2 };
    }
    case 'pedido.confirmado': {
      const d = datosV1 as DatosPedidoConfirmadoV1;
      const v2: DatosPedidoConfirmadoV2 = { ...d, monedaBase: MONEDA_BASE_V1, cotizacion: d.moneda === MONEDA_BASE_V1 ? null : d.cotizacion };
      return { ok: true, valor: v2 };
    }
    case 'venta.anulada': {
      const v2: DatosVentaAnuladaV2 = datosV1 as DatosVentaAnuladaV1;
      return { ok: true, valor: v2 };
    }
    case 'turno.cerrado': {
      const v2: DatosTurnoCerradoV2 = datosV1 as DatosTurnoCerradoV1;
      return { ok: true, valor: v2 };
    }
    default:
      return { ok: true, valor: datosV1 };
  }
}

/**
 * Lleva un sobre VÁLIDO a la forma v2: uno `version: 1` de un tipo con v2 sale con `version: 2` y datos normalizados;
 * uno que ya es v2, o de un tipo sin v2, sale sin cambios. Falla cerrado si una venta v1 no puede resolver su mercado
 * (ver `normalizarDatosAV2`). Es una vista de lectura: el sobre v1 original no se toca.
 */
export function normalizarEventoAV2(evento: SobreEvento, contexto?: ContextoNormalizacion): Resultado<SobreEvento> {
  if (evento.version !== 1 || !TIPOS_CON_V2.includes(evento.tipo)) return { ok: true, valor: evento };
  const datos = normalizarDatosAV2(evento.tipo, evento.datos, contexto);
  return datos.ok ? { ok: true, valor: { ...evento, version: 2, datos: datos.valor } } : datos;
}
