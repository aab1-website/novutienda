import type { CopiaCotizacion, IdMercado } from '../tipo-cambio/tipos.js';
import { centavos, copiaCotizacion, crearValidador, idMercadoEvento, monedaOperativa, texto, type Fixtures } from './esquema.js';
import { cotizacionArsDePrueba as cotizacionArs, errorMercadoMonedaCotizacion, esquemaLineasPedido } from './pedido-comun.js';

/** CONTRATO CONGELADO al terminar la ola 1c: un cambio incompatible exige un contrato v2. */
export const TIPO_PEDIDO_SOLICITADO_V1 = 'pedido.solicitado';

export interface LineaPedido {
  readonly productoId: string;
  readonly cantidad: number;
}

export interface DatosPedidoSolicitadoV1 {
  readonly pedidoId: string;
  readonly mercado: IdMercado;
  readonly moneda: string;
  /** Total en enteros de centavos de `moneda`. */
  readonly total: number;
  /** Cotización con la que se calculó el precio (siempre presente en pedidos). */
  readonly cotizacion: CopiaCotizacion<string>;
  readonly lineas: readonly LineaPedido[];
}

export const validarPedidoSolicitadoV1 = crearValidador<DatosPedidoSolicitadoV1>(
  {
    pedidoId: texto,
    mercado: idMercadoEvento,
    moneda: monedaOperativa,
    total: centavos,
    cotizacion: copiaCotizacion,
    lineas: esquemaLineasPedido,
  },
  errorMercadoMonedaCotizacion,
);

const valido: DatosPedidoSolicitadoV1 = {
  pedidoId: 'pd1',
  mercado: 'AR',
  moneda: 'ARS',
  total: 360000,
  cotizacion: cotizacionArs,
  lineas: [{ productoId: 'p1', cantidad: 3 }],
};

export const fixturesPedidoSolicitadoV1: Fixtures<DatosPedidoSolicitadoV1> = {
  validos: [valido, { ...valido, mercado: 'CL', moneda: 'CLP', cotizacion: { ...cotizacionArs, par: 'CLP/USD', fuente: 'manual', valor: 950 } }, { ...valido, mercado: 'BO', moneda: 'BOB', cotizacion: { ...cotizacionArs, par: 'BOB/USD', fuente: 'BCB', valor: 6.96 } }],
  invalidos: [
    { nombre: 'sin líneas', datos: { ...valido, lineas: [] } },
    { nombre: 'cantidad negativa', datos: { ...valido, lineas: [{ productoId: 'p1', cantidad: -1 }] } },
    { nombre: 'sin mercado', datos: { ...valido, mercado: undefined } },
    { nombre: 'mercado mal formado', datos: { ...valido, mercado: 'chile' } },
    { nombre: 'moneda inválida', datos: { ...valido, moneda: 'peso' } },
    { nombre: 'moneda de otro mercado', datos: { ...valido, moneda: 'BOB' } },
    { nombre: 'sin total', datos: { ...valido, total: undefined } },
    { nombre: 'total decimal', datos: { ...valido, total: 10.5 } },
    { nombre: 'sin cotización', datos: { ...valido, cotizacion: undefined } },
    { nombre: 'cotización nula', datos: { ...valido, cotizacion: null } },
    { nombre: 'cotización con par de otro mercado', datos: { ...valido, cotizacion: { ...cotizacionArs, par: 'BOB/USD' } } },
    { nombre: 'cotización con estado desconocido', datos: { ...valido, cotizacion: { ...cotizacionArs, estado: 'vencida' } } },
  ],
};
