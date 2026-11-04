import { arreglo, cantidadPositiva, crearValidador, instanteIso, objeto, texto, type Fixtures } from './esquema.js';
import type { LineaPedido } from './pedido-solicitado.v1.js';

export const TIPO_PEDIDO_CONFIRMADO_V1 = 'pedido.confirmado';

export interface DatosPedidoConfirmadoV1 {
  readonly pedidoId: string;
  readonly lineas: readonly LineaPedido[];
  /** Instante ISO 8601 UTC de la confirmación. */
  readonly confirmadoEn: string;
}

export const validarPedidoConfirmadoV1 = crearValidador<DatosPedidoConfirmadoV1>({
  pedidoId: texto,
  lineas: arreglo(objeto({ productoId: texto, cantidad: cantidadPositiva }), 1),
  confirmadoEn: instanteIso,
});

const valido: DatosPedidoConfirmadoV1 = {
  pedidoId: 'pd1',
  lineas: [{ productoId: 'p1', cantidad: 3 }],
  confirmadoEn: '2026-11-04T15:30:00Z',
};

export const fixturesPedidoConfirmadoV1: Fixtures<DatosPedidoConfirmadoV1> = {
  validos: [valido],
  invalidos: [
    { nombre: 'sin fecha', datos: { pedidoId: 'pd1', lineas: valido.lineas } },
    { nombre: 'fecha sin zona', datos: { ...valido, confirmadoEn: '2026-11-04T15:30:00' } },
    { nombre: 'sin líneas', datos: { ...valido, lineas: [] } },
  ],
};
