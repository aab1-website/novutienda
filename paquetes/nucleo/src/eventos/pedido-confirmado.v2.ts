import type { CopiaCotizacion } from '../tipo-cambio/tipos.js';
import {
  centavos, copiaCotizacionAbierta, crearValidador, errorMonedaCotizacion, idMercado, instanteIso, moneda, oNulo, texto, type Fixtures,
} from './esquema.js';
import { esquemaLineasPedido } from './pedido-comun.js';
import { cotizacionDePrueba } from './pedido-comun.v2.js';
import type { LineaPedido } from './pedido-solicitado.v1.js';

/** Contrato v2 del pedido confirmado: misma relación con la v1 que `pedido.solicitado` v2 (sin almacén, igual que la v1). */
export const TIPO_PEDIDO_CONFIRMADO_V2 = 'pedido.confirmado';

export interface DatosPedidoConfirmadoV2 {
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
  /** Instante ISO 8601 UTC de la confirmación. */
  readonly confirmadoEn: string;
}

export const validarPedidoConfirmadoV2 = crearValidador<DatosPedidoConfirmadoV2>(
  {
    pedidoId: texto,
    mercado: idMercado,
    moneda,
    monedaBase: moneda,
    total: centavos,
    cotizacion: oNulo(copiaCotizacionAbierta),
    lineas: esquemaLineasPedido,
    confirmadoEn: instanteIso,
  },
  errorMonedaCotizacion,
);

const valido: DatosPedidoConfirmadoV2 = {
  pedidoId: 'pd1',
  mercado: 'CL',
  moneda: 'CLP',
  monedaBase: 'EUR',
  total: 360000,
  cotizacion: cotizacionDePrueba,
  lineas: [{ productoId: 'p1', cantidad: 3 }],
  confirmadoEn: '2026-11-04T15:30:00Z',
};

export const fixturesPedidoConfirmadoV2: Fixtures<DatosPedidoConfirmadoV2> = {
  validos: [valido, { ...valido, mercado: 'ES', moneda: 'EUR', cotizacion: null }],
  invalidos: [
    { nombre: 'sin fecha', datos: { ...valido, confirmadoEn: undefined } },
    { nombre: 'fecha sin zona', datos: { ...valido, confirmadoEn: '2026-11-04T15:30:00' } },
    { nombre: 'sin líneas', datos: { ...valido, lineas: [] } },
    { nombre: 'almacén en el contrato', datos: { ...valido, almacenId: 'a1' } },
    { nombre: 'sin mercado', datos: { ...valido, mercado: undefined } },
    { nombre: 'mercado en minúsculas', datos: { ...valido, mercado: 'cl' } },
    { nombre: 'sin moneda base', datos: { ...valido, monedaBase: undefined } },
    { nombre: 'moneda distinta de la base sin cotización', datos: { ...valido, cotizacion: null } },
    { nombre: 'moneda igual a la base con cotización', datos: { ...valido, moneda: 'EUR' } },
    { nombre: 'cotización con par invertido', datos: { ...valido, cotizacion: { ...cotizacionDePrueba, par: 'EUR/CLP' } } },
    { nombre: 'sin total', datos: { ...valido, total: undefined } },
  ],
};
