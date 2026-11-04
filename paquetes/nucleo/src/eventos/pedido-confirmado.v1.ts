import type { CopiaCotizacion, Mercado } from '../tipo-cambio/tipos.js';
import { centavos, copiaCotizacion, crearValidador, instanteIso, monedaOperativa, texto, uno, type Fixtures } from './esquema.js';
import { cotizacionArsDePrueba as cotizacionArs, errorMercadoMonedaCotizacion, esquemaLineasPedido } from './pedido-comun.js';
import type { LineaPedido } from './pedido-solicitado.v1.js';

/** CONTRATO CONGELADO al terminar la ola 1c: un cambio incompatible exige un contrato v2. */
export const TIPO_PEDIDO_CONFIRMADO_V1 = 'pedido.confirmado';

/** Sin almacén: Inventarios descuenta siempre de `tienda` (decisión de la dirección). */
export interface DatosPedidoConfirmadoV1 {
  readonly pedidoId: string;
  readonly mercado: Mercado;
  readonly moneda: string;
  /** Total en enteros de centavos de `moneda`. */
  readonly total: number;
  readonly cotizacion: CopiaCotizacion;
  readonly lineas: readonly LineaPedido[];
  /** Instante ISO 8601 UTC de la confirmación. */
  readonly confirmadoEn: string;
}

export const validarPedidoConfirmadoV1 = crearValidador<DatosPedidoConfirmadoV1>(
  {
    pedidoId: texto,
    mercado: uno(['BO', 'AR']),
    moneda: monedaOperativa,
    total: centavos,
    cotizacion: copiaCotizacion,
    lineas: esquemaLineasPedido,
    confirmadoEn: instanteIso,
  },
  errorMercadoMonedaCotizacion,
);

const valido: DatosPedidoConfirmadoV1 = {
  pedidoId: 'pd1',
  mercado: 'AR',
  moneda: 'ARS',
  total: 360000,
  cotizacion: cotizacionArs,
  lineas: [{ productoId: 'p1', cantidad: 3 }],
  confirmadoEn: '2026-11-04T15:30:00Z',
};

export const fixturesPedidoConfirmadoV1: Fixtures<DatosPedidoConfirmadoV1> = {
  validos: [valido],
  invalidos: [
    { nombre: 'sin fecha', datos: { ...valido, confirmadoEn: undefined } },
    { nombre: 'fecha sin zona', datos: { ...valido, confirmadoEn: '2026-11-04T15:30:00' } },
    { nombre: 'sin líneas', datos: { ...valido, lineas: [] } },
    { nombre: 'almacén en el contrato (ya no existe: Inventarios descuenta de tienda)', datos: { ...valido, almacenId: 'a1' } },
    { nombre: 'sin mercado', datos: { ...valido, mercado: undefined } },
    { nombre: 'mercado desconocido', datos: { ...valido, mercado: 'CL' } },
    { nombre: 'sin total', datos: { ...valido, total: undefined } },
    { nombre: 'sin cotización', datos: { ...valido, cotizacion: undefined } },
    { nombre: 'cotización con par de otro mercado', datos: { ...valido, cotizacion: { ...cotizacionArs, par: 'BOB/USD' } } },
    { nombre: 'moneda de otro mercado', datos: { ...valido, moneda: 'BOB' } },
  ],
};
