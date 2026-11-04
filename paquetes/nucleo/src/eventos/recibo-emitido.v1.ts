import { crearValidador, texto, type Fixtures } from './esquema.js';

export const TIPO_RECIBO_EMITIDO_V1 = 'recibo.emitido';

export interface DatosReciboEmitidoV1 {
  readonly reciboId: string;
  readonly ventaId: string;
  /** Número correlativo legible del recibo. */
  readonly numero: string;
}

export const validarReciboEmitidoV1 = crearValidador<DatosReciboEmitidoV1>({ reciboId: texto, ventaId: texto, numero: texto });

const valido: DatosReciboEmitidoV1 = { reciboId: 'r1', ventaId: 'v1', numero: 'A-000123' };

export const fixturesReciboEmitidoV1: Fixtures<DatosReciboEmitidoV1> = {
  validos: [valido],
  invalidos: [
    { nombre: 'sin número', datos: { reciboId: 'r1', ventaId: 'v1' } },
    { nombre: 'número numérico', datos: { ...valido, numero: 123 } },
    { nombre: 'venta vacía', datos: { ...valido, ventaId: '' } },
  ],
};
