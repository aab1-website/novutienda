import {
  arreglo, cantidadPositiva, centavos, crearValidador, errorSeriesLineas, medioPago, monedaOperativa, objeto, texto, type Fixtures,
} from './esquema.js';
import type { MedioPagoVenta } from './venta-confirmada.v1.js';

/** CONTRATO CONGELADO al terminar la ola 1c: un cambio incompatible exige un contrato v2. */
export const TIPO_VENTA_ANULADA_V1 = 'venta.anulada';

/** Línea devuelta: con esto Inventarios revierte el stock sin leer datos del POS. */
export interface LineaVentaAnulada {
  readonly productoId: string;
  readonly cantidad: number;
  readonly almacenId: string;
  readonly series: readonly string[];
}

export interface ReembolsoVenta {
  readonly medio: MedioPagoVenta;
  readonly moneda: string;
  /** Enteros de centavos. */
  readonly monto: number;
}

export interface DatosVentaAnuladaV1 {
  readonly ventaId: string;
  /** Turno de la venta original. */
  readonly turnoId: string;
  readonly motivo: string;
  /** Uid de quien registró la anulación. */
  readonly anuladaPor: string;
  /** Uid de quien aprobó la anulación. */
  readonly aprobadoPor: string;
  readonly lineas: readonly LineaVentaAnulada[];
  readonly reembolso: ReembolsoVenta;
  /** Turno en el que se entrega el reembolso (puede diferir del turno original). */
  readonly turnoIdReembolso: string;
}

export const validarVentaAnuladaV1 = crearValidador<DatosVentaAnuladaV1>(
  {
    ventaId: texto,
    turnoId: texto,
    motivo: texto,
    anuladaPor: texto,
    aprobadoPor: texto,
    lineas: arreglo(objeto({ productoId: texto, cantidad: cantidadPositiva, almacenId: texto, series: arreglo(texto) }), 1),
    reembolso: objeto({ medio: medioPago, moneda: monedaOperativa, monto: centavos }),
    turnoIdReembolso: texto,
  },
  (d) => errorSeriesLineas(d.lineas, 'datos.lineas'),
);

const valido: DatosVentaAnuladaV1 = {
  ventaId: 'v1',
  turnoId: 't1',
  motivo: 'Error de digitación',
  anuladaPor: 'u-caj',
  aprobadoPor: 'u-sup',
  lineas: [{ productoId: 'p1', cantidad: 2, almacenId: 'a1', series: ['S1', 'S2'] }],
  reembolso: { medio: 'efectivo', moneda: 'BOB', monto: 125000 },
  turnoIdReembolso: 't2',
};

export const fixturesVentaAnuladaV1: Fixtures<DatosVentaAnuladaV1> = {
  validos: [valido, { ...valido, lineas: [{ productoId: 'p2', cantidad: 3, almacenId: 'a1', series: [] }], turnoIdReembolso: 't1' }],
  invalidos: [
    { nombre: 'sin motivo', datos: { ...valido, motivo: undefined } },
    { nombre: 'motivo vacío', datos: { ...valido, motivo: ' ' } },
    { nombre: 'sin aprobador', datos: { ...valido, aprobadoPor: undefined } },
    { nombre: 'sin quien anula', datos: { ...valido, anuladaPor: undefined } },
    { nombre: 'sin turno original', datos: { ...valido, turnoId: undefined } },
    { nombre: 'sin turno de reembolso', datos: { ...valido, turnoIdReembolso: undefined } },
    { nombre: 'campo sobrante', datos: { ...valido, extra: true } },
    { nombre: 'sin líneas', datos: { ...valido, lineas: [] } },
    { nombre: 'series que no igualan la cantidad', datos: { ...valido, lineas: [{ ...valido.lineas[0], series: ['S1'] }] } },
    { nombre: 'serie repetida entre líneas', datos: { ...valido, lineas: [{ ...valido.lineas[0], cantidad: 1, series: ['S1'] }, { ...valido.lineas[0], productoId: 'p9', cantidad: 1, series: ['S1'] }] } },
    { nombre: 'sin reembolso', datos: { ...valido, reembolso: undefined } },
    { nombre: 'reembolso decimal', datos: { ...valido, reembolso: { ...valido.reembolso, monto: 1.5 } } },
    { nombre: 'medio de reembolso desconocido', datos: { ...valido, reembolso: { ...valido.reembolso, medio: 'cheque' } } },
    { nombre: 'moneda de reembolso inválida', datos: { ...valido, reembolso: { ...valido.reembolso, moneda: 'EUR' } } },
  ],
};
