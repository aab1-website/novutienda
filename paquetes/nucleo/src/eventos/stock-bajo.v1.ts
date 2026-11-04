import { crearValidador, entero, texto, type Fixtures } from './esquema.js';

export const TIPO_STOCK_BAJO_V1 = 'stock.bajo';

export interface DatosStockBajoV1 {
  readonly productoId: string;
  /** Saldo sumado de todos los almacenes. */
  readonly saldoTotal: number;
  readonly minimo: number;
}

export const validarStockBajoV1 = crearValidador<DatosStockBajoV1>(
  { productoId: texto, saldoTotal: entero(), minimo: entero(0) },
  (d) => (d.saldoTotal > d.minimo ? 'datos.saldoTotal debe ser menor o igual al mínimo' : null),
);

const valido: DatosStockBajoV1 = { productoId: 'p1', saldoTotal: 2, minimo: 5 };

export const fixturesStockBajoV1: Fixtures<DatosStockBajoV1> = {
  validos: [valido, { productoId: 'p2', saldoTotal: 5, minimo: 5 }],
  invalidos: [
    { nombre: 'saldo sobre el mínimo', datos: { ...valido, saldoTotal: 9 } },
    { nombre: 'mínimo negativo', datos: { ...valido, minimo: -1 } },
    { nombre: 'sin producto', datos: { saldoTotal: 1, minimo: 5 } },
  ],
};
