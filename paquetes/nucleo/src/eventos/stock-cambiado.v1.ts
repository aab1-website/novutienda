import { crearValidador, entero, objeto, texto, uno, type Fixtures } from './esquema.js';

/** CONTRATO CONGELADO al terminar la ola 1c: un cambio incompatible exige un contrato v2. */
export const TIPO_STOCK_CAMBIADO_V1 = 'stock.cambiado';

export const MOTIVOS_STOCK_CAMBIADO_V1 = ['venta', 'anulacion', 'traspaso', 'ajuste', 'merma', 'ingreso', 'conteo', 'pedido'] as const;
export type MotivoStockCambiado = (typeof MOTIVOS_STOCK_CAMBIADO_V1)[number];

export interface DatosStockCambiadoV1 {
  readonly productoId: string;
  readonly almacenId: string;
  /** Variación en unidades; nunca cero. */
  readonly delta: number;
  /** Saldo del almacén después del movimiento. */
  readonly saldo: number;
  readonly movimientoId: string;
  readonly motivo: MotivoStockCambiado;
  /** Uid de quien originó el movimiento. */
  readonly por: string;
  /** Documento que lo originó (por ejemplo `{ tipo: 'venta', id: 'v1' }`). */
  readonly referencia: { readonly tipo: string; readonly id: string };
}

export const validarStockCambiadoV1 = crearValidador<DatosStockCambiadoV1>(
  {
    productoId: texto,
    almacenId: texto,
    delta: entero(),
    saldo: entero(),
    movimientoId: texto,
    motivo: uno(MOTIVOS_STOCK_CAMBIADO_V1),
    por: texto,
    referencia: objeto({ tipo: texto, id: texto }),
  },
  (d) => (d.delta === 0 ? 'datos.delta no puede ser cero' : null),
);

const valido: DatosStockCambiadoV1 = {
  productoId: 'p1',
  almacenId: 'a1',
  delta: -2,
  saldo: 8,
  movimientoId: 'm1',
  motivo: 'venta',
  por: 'u-caj',
  referencia: { tipo: 'venta', id: 'v1' },
};

export const fixturesStockCambiadoV1: Fixtures<DatosStockCambiadoV1> = {
  validos: [valido, { ...valido, delta: 5, saldo: 13, motivo: 'ingreso', referencia: { tipo: 'compra', id: 'c9' } }],
  invalidos: [
    { nombre: 'delta cero', datos: { ...valido, delta: 0 } },
    { nombre: 'delta decimal', datos: { ...valido, delta: 0.5 } },
    { nombre: 'sin movimiento', datos: { ...valido, movimientoId: undefined } },
    { nombre: 'saldo como texto', datos: { ...valido, saldo: '8' } },
    { nombre: 'sin motivo', datos: { ...valido, motivo: undefined } },
    { nombre: 'motivo desconocido', datos: { ...valido, motivo: 'robo' } },
    { nombre: 'sin autor', datos: { ...valido, por: '' } },
    { nombre: 'sin referencia', datos: { ...valido, referencia: undefined } },
    { nombre: 'referencia sin id', datos: { ...valido, referencia: { tipo: 'venta' } } },
  ],
};
