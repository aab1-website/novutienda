import type { CopiaCotizacion } from '../tipo-cambio/tipos.js';
import { centavos, copiaCotizacionAbierta, crearValidador, errorMonedaCotizacion, idMercado, moneda, oNulo, texto, type Fixtures } from './esquema.js';
import { esquemaLineasPedido } from './pedido-comun.js';
import { cotizacionDePrueba } from './pedido-comun.v2.js';
import type { LineaPedido } from './pedido-solicitado.v1.js';

/**
 * Contrato v2 del pedido solicitado: los campos de la v1 con cualquier mercado y moneda declarados por el tenant,
 * `monedaBase` explícita y cotización opcional. Que el mercado y la moneda existan en el tenant lo comprueba el
 * servidor (`coherenteConComercial`), no el esquema.
 */
export const TIPO_PEDIDO_SOLICITADO_V2 = 'pedido.solicitado';

export interface DatosPedidoSolicitadoV2 {
  readonly pedidoId: string;
  /** Dos letras mayúsculas. */
  readonly mercado: string;
  readonly moneda: string;
  readonly monedaBase: string;
  /** Total en enteros de centavos de `moneda`. */
  readonly total: number;
  /** `null` si y solo si `moneda === monedaBase`; si no, su par es `moneda/monedaBase`. */
  readonly cotizacion: CopiaCotizacion<string> | null;
  readonly lineas: readonly LineaPedido[];
}

export const validarPedidoSolicitadoV2 = crearValidador<DatosPedidoSolicitadoV2>(
  {
    pedidoId: texto,
    mercado: idMercado,
    moneda,
    monedaBase: moneda,
    total: centavos,
    cotizacion: oNulo(copiaCotizacionAbierta),
    lineas: esquemaLineasPedido,
  },
  errorMonedaCotizacion,
);

const valido: DatosPedidoSolicitadoV2 = {
  pedidoId: 'pd1',
  mercado: 'CL',
  moneda: 'CLP',
  monedaBase: 'EUR',
  total: 360000,
  cotizacion: cotizacionDePrueba,
  lineas: [{ productoId: 'p1', cantidad: 3 }],
};

export const fixturesPedidoSolicitadoV2: Fixtures<DatosPedidoSolicitadoV2> = {
  validos: [
    valido,
    { ...valido, mercado: 'ES', moneda: 'EUR', cotizacion: null },
    { ...valido, mercado: 'BO', moneda: 'BOB', monedaBase: 'USD', cotizacion: { ...cotizacionDePrueba, par: 'BOB/USD', fuente: 'BCB' } },
  ],
  invalidos: [
    { nombre: 'sin líneas', datos: { ...valido, lineas: [] } },
    { nombre: 'sin mercado', datos: { ...valido, mercado: undefined } },
    { nombre: 'mercado en minúsculas', datos: { ...valido, mercado: 'cl' } },
    { nombre: 'mercado de tres letras', datos: { ...valido, mercado: 'CHL' } },
    { nombre: 'moneda inválida', datos: { ...valido, moneda: 'peso' } },
    { nombre: 'sin moneda base', datos: { ...valido, monedaBase: undefined } },
    { nombre: 'moneda distinta de la base sin cotización', datos: { ...valido, cotizacion: null } },
    { nombre: 'cotización ausente (clave faltante)', datos: { ...valido, cotizacion: undefined } },
    { nombre: 'moneda igual a la base con cotización', datos: { ...valido, moneda: 'EUR' } },
    { nombre: 'cotización con par invertido', datos: { ...valido, cotizacion: { ...cotizacionDePrueba, par: 'EUR/CLP' } } },
    { nombre: 'cotización con estado desconocido', datos: { ...valido, cotizacion: { ...cotizacionDePrueba, estado: 'vencida' } } },
    { nombre: 'total decimal', datos: { ...valido, total: 10.5 } },
    { nombre: 'campo sobrante', datos: { ...valido, extra: 1 } },
  ],
};
