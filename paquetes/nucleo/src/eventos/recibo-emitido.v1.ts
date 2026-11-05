import { arreglo, crearValidador, fechaIso, objeto, opcional, texto, type Fixtures } from './esquema.js';

/** CONTRATO CONGELADO al terminar la ola 1c: un cambio incompatible exige un contrato v2. */
export const TIPO_RECIBO_EMITIDO_V1 = 'recibo.emitido';

export interface GarantiaRecibo {
  readonly serie: string;
  /** Fecha aaaa-mm-dd hasta la que rige la garantía. */
  readonly hasta: string;
}

export interface DatosReciboEmitidoV1 {
  readonly reciboId: string;
  readonly ventaId: string;
  /** Número correlativo legible del recibo. */
  readonly numero: string;
  /** Referencia a la factura emitida por el sistema tributario, si existe. */
  readonly facturaSuma?: string;
  readonly garantias: readonly GarantiaRecibo[];
  readonly envioWhatsapp?: { readonly estado: string };
}

export const validarReciboEmitidoV1 = crearValidador<DatosReciboEmitidoV1>({
  reciboId: texto,
  ventaId: texto,
  numero: texto,
  facturaSuma: opcional(texto),
  garantias: arreglo(objeto({ serie: texto, hasta: fechaIso })),
  envioWhatsapp: opcional(objeto({ estado: texto })),
});

const valido: DatosReciboEmitidoV1 = {
  reciboId: 'r1',
  ventaId: 'v1',
  numero: 'A-000123',
  facturaSuma: 'F-2026-0045',
  garantias: [{ serie: 'S1', hasta: '2027-11-04' }],
  envioWhatsapp: { estado: 'enviado' },
};

export const fixturesReciboEmitidoV1: Fixtures<DatosReciboEmitidoV1> = {
  validos: [valido, { reciboId: 'r2', ventaId: 'v2', numero: 'A-000124', garantias: [] }],
  invalidos: [
    { nombre: 'sin número', datos: { ...valido, numero: undefined } },
    { nombre: 'número numérico', datos: { ...valido, numero: 123 } },
    { nombre: 'venta vacía', datos: { ...valido, ventaId: '' } },
    { nombre: 'sin garantías', datos: { ...valido, garantias: undefined } },
    { nombre: 'garantía con fecha inexistente', datos: { ...valido, garantias: [{ serie: 'S1', hasta: '2027-02-30' }] } },
    { nombre: 'garantía con instante en vez de fecha', datos: { ...valido, garantias: [{ serie: 'S1', hasta: '2027-11-04T00:00:00Z' }] } },
    { nombre: 'garantía sin serie', datos: { ...valido, garantias: [{ hasta: '2027-11-04' }] } },
    { nombre: 'factura vacía', datos: { ...valido, facturaSuma: ' ' } },
    { nombre: 'envío sin estado', datos: { ...valido, envioWhatsapp: {} } },
    { nombre: 'campo sobrante', datos: { ...valido, extra: 1 } },
  ],
};
