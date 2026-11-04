import { arreglo, cantidadPositiva, centavos, crearValidador, instanteIso, moneda, numeroPositivo, objeto, par, texto, type Fixtures } from './esquema.js';

export const TIPO_VENTA_CONFIRMADA_V1 = 'venta.confirmada';

/** Cotización congelada en la venta (el valor no es un monto: se conserva como número). */
export interface CotizacionVenta {
  readonly id: string;
  readonly par: string;
  readonly valor: number;
  readonly fecha: string;
  readonly fuente: string;
  readonly estado: string;
}

export interface LineaVentaConfirmada {
  readonly productoId: string;
  readonly cantidad: number;
  readonly almacenId: string;
  readonly series: readonly string[];
}

export interface DatosVentaConfirmadaV1 {
  readonly ventaId: string;
  readonly turnoId: string;
  readonly moneda: string;
  /** Total en enteros de centavos. */
  readonly total: number;
  readonly cotizacion: CotizacionVenta;
  readonly lineas: readonly LineaVentaConfirmada[];
}

export const validarVentaConfirmadaV1 = crearValidador<DatosVentaConfirmadaV1>({
  ventaId: texto,
  turnoId: texto,
  moneda,
  total: centavos,
  cotizacion: objeto({ id: texto, par, valor: numeroPositivo, fecha: instanteIso, fuente: texto, estado: texto }),
  lineas: arreglo(objeto({ productoId: texto, cantidad: cantidadPositiva, almacenId: texto, series: arreglo(texto) }), 1),
});

const valido: DatosVentaConfirmadaV1 = {
  ventaId: 'v1',
  turnoId: 't1',
  moneda: 'BOB',
  total: 125050,
  cotizacion: { id: 'c1', par: 'USD/BOB', valor: 6.96, fecha: '2026-11-04T12:00:00Z', fuente: 'BCB', estado: 'vigente' },
  lineas: [{ productoId: 'p1', cantidad: 2, almacenId: 'a1', series: ['S1', 'S2'] }],
};

export const fixturesVentaConfirmadaV1: Fixtures<DatosVentaConfirmadaV1> = {
  validos: [valido, { ...valido, lineas: [{ productoId: 'p2', cantidad: 1, almacenId: 'a1', series: [] }] }],
  invalidos: [
    { nombre: 'total decimal', datos: { ...valido, total: 10.5 } },
    { nombre: 'total negativo', datos: { ...valido, total: -1 } },
    { nombre: 'sin líneas', datos: { ...valido, lineas: [] } },
    { nombre: 'cantidad cero', datos: { ...valido, lineas: [{ productoId: 'p1', cantidad: 0, almacenId: 'a1', series: [] }] } },
    { nombre: 'sin cotización', datos: { ventaId: 'v1', turnoId: 't1', moneda: 'BOB', total: 1, lineas: valido.lineas } },
    { nombre: 'moneda en minúsculas', datos: { ...valido, moneda: 'bob' } },
    { nombre: 'campo sobrante', datos: { ...valido, extra: 1 } },
    { nombre: 'no es objeto', datos: 'venta' },
  ],
};
