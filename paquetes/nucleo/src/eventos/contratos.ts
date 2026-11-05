import type { Resultado } from '../contratos/claim.js';
import { validarSobre, type SobreEvento } from '../contratos/sobre-evento.js';
import { validarPedidoConfirmadoV1 } from './pedido-confirmado.v1.js';
import { validarPedidoSolicitadoV1 } from './pedido-solicitado.v1.js';
import { validarReciboEmitidoV1 } from './recibo-emitido.v1.js';
import { validarStockBajoV1 } from './stock-bajo.v1.js';
import { validarStockCambiadoV1 } from './stock-cambiado.v1.js';
import { validarTurnoCerradoV1 } from './turno-cerrado.v1.js';
import { validarVentaAnuladaV1 } from './venta-anulada.v1.js';
import { validarVentaConfirmadaV1 } from './venta-confirmada.v1.js';

type ValidadorDatos = (datos: unknown) => Resultado<unknown>;

/** Contratos vigentes por tipo; todos están en la versión 1. */
export const CONTRATOS_V1: Readonly<Record<string, ValidadorDatos>> = {
  'venta.confirmada': validarVentaConfirmadaV1,
  'venta.anulada': validarVentaAnuladaV1,
  'turno.cerrado': validarTurnoCerradoV1,
  'stock.cambiado': validarStockCambiadoV1,
  'stock.bajo': validarStockBajoV1,
  'recibo.emitido': validarReciboEmitidoV1,
  'pedido.solicitado': validarPedidoSolicitadoV1,
  'pedido.confirmado': validarPedidoConfirmadoV1,
};

/**
 * Valida el sobre y los datos según el contrato de su tipo y versión.
 * Rechaza versiones y tipos desconocidos.
 */
export function validarEvento(x: unknown): Resultado<SobreEvento> {
  if (typeof x === 'object' && x !== null && 'version' in x && (x as { version: unknown }).version !== 1) {
    return { ok: false, error: 'Versión de evento desconocida' };
  }
  const sobre = validarSobre(x);
  if (!sobre.ok) return sobre;
  const validador = Object.hasOwn(CONTRATOS_V1, sobre.valor.tipo) ? CONTRATOS_V1[sobre.valor.tipo] : undefined;
  if (validador === undefined) return { ok: false, error: `Tipo de evento desconocido: ${sobre.valor.tipo}` };
  const datos = validador(sobre.valor.datos);
  return datos.ok ? sobre : { ok: false, error: datos.error };
}
