import { crearValidador, texto, type Fixtures } from './esquema.js';

export const TIPO_VENTA_ANULADA_V1 = 'venta.anulada';

export interface DatosVentaAnuladaV1 {
  readonly ventaId: string;
  readonly motivo: string;
  /** Uid de quien aprobó la anulación. */
  readonly aprobadoPor: string;
}

export const validarVentaAnuladaV1 = crearValidador<DatosVentaAnuladaV1>({ ventaId: texto, motivo: texto, aprobadoPor: texto });

const valido: DatosVentaAnuladaV1 = { ventaId: 'v1', motivo: 'Error de digitación', aprobadoPor: 'u-sup' };

export const fixturesVentaAnuladaV1: Fixtures<DatosVentaAnuladaV1> = {
  validos: [valido],
  invalidos: [
    { nombre: 'sin motivo', datos: { ventaId: 'v1', aprobadoPor: 'u-sup' } },
    { nombre: 'motivo vacío', datos: { ...valido, motivo: ' ' } },
    { nombre: 'sin aprobador', datos: { ventaId: 'v1', motivo: 'x' } },
    { nombre: 'campo sobrante', datos: { ...valido, extra: true } },
  ],
};
