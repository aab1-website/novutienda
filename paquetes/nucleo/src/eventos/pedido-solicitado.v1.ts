import { arreglo, cantidadPositiva, crearValidador, moneda, objeto, texto, type Fixtures } from './esquema.js';

export const TIPO_PEDIDO_SOLICITADO_V1 = 'pedido.solicitado';

export interface LineaPedido {
  readonly productoId: string;
  readonly cantidad: number;
}

export interface DatosPedidoSolicitadoV1 {
  readonly pedidoId: string;
  /** Mercado de origen del pedido (por ejemplo `BO` o `AR`). */
  readonly mercado: string;
  readonly moneda: string;
  readonly lineas: readonly LineaPedido[];
}

export const validarPedidoSolicitadoV1 = crearValidador<DatosPedidoSolicitadoV1>({
  pedidoId: texto,
  mercado: texto,
  moneda,
  lineas: arreglo(objeto({ productoId: texto, cantidad: cantidadPositiva }), 1),
});

const valido: DatosPedidoSolicitadoV1 = {
  pedidoId: 'pd1',
  mercado: 'AR',
  moneda: 'ARS',
  lineas: [{ productoId: 'p1', cantidad: 3 }],
};

export const fixturesPedidoSolicitadoV1: Fixtures<DatosPedidoSolicitadoV1> = {
  validos: [valido],
  invalidos: [
    { nombre: 'sin líneas', datos: { ...valido, lineas: [] } },
    { nombre: 'cantidad negativa', datos: { ...valido, lineas: [{ productoId: 'p1', cantidad: -1 }] } },
    { nombre: 'sin mercado', datos: { pedidoId: 'pd1', moneda: 'ARS', lineas: valido.lineas } },
    { nombre: 'moneda inválida', datos: { ...valido, moneda: 'peso' } },
  ],
};
