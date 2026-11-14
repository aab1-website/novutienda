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

/** Versiones de evento que se entregan por omisión: solo la 1, como antes de existir la 2 (nadie recibe v2 sin pedirlo). */
export const VERSIONES_POR_OMISION: readonly (1 | 2)[] = [1];

export interface OpcionesValidarEvento {
  /** Versiones del sobre que quien llama entiende; por omisión, solo la 1. Un v2 solo llega a quien lo declara. */
  readonly versiones?: readonly (1 | 2)[];
}

/**
 * Valida el sobre y los datos según el contrato de su tipo y versión.
 * Rechaza versiones y tipos desconocidos. Sin opciones acepta SOLO la versión 1 (igual que antes de la 2): un
 * consumidor que entiende la 2 lo declara con `{ versiones: [1, 2] }`.
 */
export function validarEvento(x: unknown, opciones: OpcionesValidarEvento = {}): Resultado<SobreEvento> {
  const versiones = opciones.versiones ?? VERSIONES_POR_OMISION;
  if (typeof x === 'object' && x !== null && 'version' in x) {
    const v = (x as { version: unknown }).version;
    if (v !== 1 && v !== 2) return { ok: false, error: 'Versión de evento desconocida' };
    if (!versiones.includes(v) || !Object.hasOwn(CONTRATOS_POR_VERSION, v)) return { ok: false, error: 'Versión de evento desconocida' };
  }
  const sobre = validarSobre(x, versiones);
  if (!sobre.ok) return sobre;
  const contratos = CONTRATOS_POR_VERSION[sobre.valor.version];
  const validador = contratos !== undefined && Object.hasOwn(contratos, sobre.valor.tipo) ? contratos[sobre.valor.tipo] : undefined;
  if (validador === undefined) return { ok: false, error: `Tipo de evento desconocido: ${sobre.valor.tipo}` };
  const datos = validador(sobre.valor.datos);
  return datos.ok ? sobre : { ok: false, error: datos.error };
}
