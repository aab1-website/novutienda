import type { Resultado } from '../contratos/claim.js';
import { validarSobre, type SobreEvento } from '../contratos/sobre-evento.js';
import { validarPedidoConfirmadoV1 } from './pedido-confirmado.v1.js';
import { validarPedidoSolicitadoV1 } from './pedido-solicitado.v1.js';
import { validarPedidoConfirmadoV2 } from './pedido-confirmado.v2.js';
import { validarPedidoSolicitadoV2 } from './pedido-solicitado.v2.js';
import { validarTurnoCerradoV2 } from './turno-cerrado.v2.js';
import { validarVentaAnuladaV2 } from './venta-anulada.v2.js';
import { validarVentaConfirmadaV2 } from './venta-confirmada.v2.js';
import { validarProductoCambiadoV1 } from './producto-cambiado.v1.js';
import { validarReciboEmitidoV1 } from './recibo-emitido.v1.js';
import { validarStockBajoV1 } from './stock-bajo.v1.js';
import { validarStockCambiadoV1 } from './stock-cambiado.v1.js';
import { validarTurnoCerradoV1 } from './turno-cerrado.v1.js';
import { validarVentaAnuladaV1 } from './venta-anulada.v1.js';
import { validarVentaConfirmadaV1 } from './venta-confirmada.v1.js';

type ValidadorDatos = (datos: unknown) => Resultado<unknown>;

/** Contratos de la versión 1 por tipo (congelados). */
export const CONTRATOS_V1: Readonly<Record<string, ValidadorDatos>> = {
  'venta.confirmada': validarVentaConfirmadaV1,
  'venta.anulada': validarVentaAnuladaV1,
  'turno.cerrado': validarTurnoCerradoV1,
  'producto.cambiado': validarProductoCambiadoV1,
  'stock.cambiado': validarStockCambiadoV1,
  'stock.bajo': validarStockBajoV1,
  'recibo.emitido': validarReciboEmitidoV1,
  'pedido.solicitado': validarPedidoSolicitadoV1,
  'pedido.confirmado': validarPedidoConfirmadoV1,
};

/**
 * Contratos de la versión 2 por tipo: solo los eventos que llevan mercado, moneda o cotización. Comparten nombre de
 * tipo con su v1 (los manifiestos declaran tipos, no versiones); el sobre trae `version: 2`. Los demás tipos
 * no tienen versión 2 y un sobre `version: 2` de esos tipos se rechaza.
 */
export const CONTRATOS_V2: Readonly<Record<string, ValidadorDatos>> = {
  'venta.confirmada': validarVentaConfirmadaV2,
  'venta.anulada': validarVentaAnuladaV2,
  'turno.cerrado': validarTurnoCerradoV2,
  'pedido.solicitado': validarPedidoSolicitadoV2,
  'pedido.confirmado': validarPedidoConfirmadoV2,
};

/** Registro de contratos por versión del sobre; una versión que no está aquí se rechaza. */
export const CONTRATOS_POR_VERSION: Readonly<Record<number, Readonly<Record<string, ValidadorDatos>>>> = {
  1: CONTRATOS_V1,
  2: CONTRATOS_V2,
};

/**
 * Valida el sobre y los datos según el contrato de su tipo y versión.
 * Rechaza versiones y tipos desconocidos.
 */
export function validarEvento(x: unknown): Resultado<SobreEvento> {
  if (typeof x === 'object' && x !== null && 'version' in x) {
    const v = (x as { version: unknown }).version;
    if (typeof v !== 'number' || !Object.hasOwn(CONTRATOS_POR_VERSION, v)) return { ok: false, error: 'Versión de evento desconocida' };
  }
  const sobre = validarSobre(x, [1, 2]);
  if (!sobre.ok) return sobre;
  const contratos = CONTRATOS_POR_VERSION[sobre.valor.version];
  const validador = contratos !== undefined && Object.hasOwn(contratos, sobre.valor.tipo) ? contratos[sobre.valor.tipo] : undefined;
  if (validador === undefined) return { ok: false, error: `Tipo de evento desconocido: ${sobre.valor.tipo} (versión ${sobre.valor.version})` };
  const datos = validador(sobre.valor.datos);
  return datos.ok ? sobre : { ok: false, error: datos.error };
}
