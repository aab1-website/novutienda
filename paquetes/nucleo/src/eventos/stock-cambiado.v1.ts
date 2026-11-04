import { crearValidador, entero, texto, type Fixtures } from './esquema.js';

export const TIPO_STOCK_CAMBIADO_V1 = 'stock.cambiado';

export interface DatosStockCambiadoV1 {
  readonly productoId: string;
  readonly almacenId: string;
  /** Variación en unidades; nunca cero. */
  readonly delta: number;
  /** Saldo del almacén después del movimiento. */
  readonly saldo: number;
  readonly movimientoId: string;
}

export const validarStockCambiadoV1 = crearValidador<DatosStockCambiadoV1>(
  { productoId: texto, almacenId: texto, delta: entero(), saldo: entero(), movimientoId: texto },
  (d) => (d.delta === 0 ? 'datos.delta no puede ser cero' : null),
);

const valido: DatosStockCambiadoV1 = { productoId: 'p1', almacenId: 'a1', delta: -2, saldo: 8, movimientoId: 'm1' };

export const fixturesStockCambiadoV1: Fixtures<DatosStockCambiadoV1> = {
  validos: [valido, { ...valido, delta: 5, saldo: 13 }],
  invalidos: [
    { nombre: 'delta cero', datos: { ...valido, delta: 0 } },
    { nombre: 'delta decimal', datos: { ...valido, delta: 0.5 } },
    { nombre: 'sin movimiento', datos: { productoId: 'p1', almacenId: 'a1', delta: 1, saldo: 1 } },
    { nombre: 'saldo como texto', datos: { ...valido, saldo: '8' } },
  ],
};
