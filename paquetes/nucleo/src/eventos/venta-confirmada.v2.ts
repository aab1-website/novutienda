import type { CopiaCotizacion } from '../tipo-cambio/tipos.js';
import {
  arreglo, cantidadPositiva, centavos, copiaCotizacionAbierta, crearValidador, entero, errorMonedaCotizacion, errorSeriesLineas,
  medioPago, moneda, objeto, oNulo, opcional, texto, type Fixtures,
} from './esquema.js';
import type { ClienteVenta, DescuentoVenta, LineaVentaConfirmada, MedioPagoVenta } from './venta-confirmada.v1.js';

/**
 * Contrato v2 de la venta: los mismos campos que la v1 (mismos nombres y semántica), con cualquier moneda ISO declarada
 * por el tenant, `monedaBase` explícita y cotización opcional con cualquier par `VENTA/BASE`. Una venta v1 es un caso
 * de v2 con `monedaBase: 'USD'`. Que la moneda exista en el tenant lo comprueba el servidor (`coherenteConComercial`).
 */
export const TIPO_VENTA_CONFIRMADA_V2 = 'venta.confirmada';

export interface PagoVentaV2 {
  readonly medio: MedioPagoVenta;
  readonly moneda: string;
  readonly monto: number;
  readonly recibido?: number;
  readonly cambio?: number;
  readonly referencia?: string;
}

export interface DatosVentaConfirmadaV2 {
  readonly ventaId: string;
  readonly turnoId: string;
  readonly cajaId: string;
  readonly cajeroUid: string;
  readonly numeroRecibo: string;
  /** Moneda de venta: precios, descuento, total y pagos están en ella. */
  readonly moneda: string;
  /** Moneda en que el tenant guarda el precio base de lo vendido. */
  readonly monedaBase: string;
  readonly total: number;
  /** `null` si y solo si `moneda === monedaBase`; si no, su par es `moneda/monedaBase`. */
  readonly cotizacion: CopiaCotizacion<string> | null;
  readonly descuento?: DescuentoVenta;
  readonly lineas: readonly LineaVentaConfirmada[];
  readonly pagos: readonly PagoVentaV2[];
  readonly cliente?: ClienteVenta;
}

export const validarVentaConfirmadaV2 = crearValidador<DatosVentaConfirmadaV2>(
  {
    ventaId: texto,
    turnoId: texto,
    cajaId: texto,
    cajeroUid: texto,
    numeroRecibo: texto,
    moneda,
    monedaBase: moneda,
    total: centavos,
    cotizacion: oNulo(copiaCotizacionAbierta),
    descuento: opcional(objeto({ monto: entero(1), motivo: texto, aprobadoPor: opcional(texto) })),
    lineas: arreglo(
      objeto({
        productoId: texto,
        nombre: texto,
        cantidad: cantidadPositiva,
        precioUnitario: centavos,
        almacenId: texto,
        series: arreglo(texto),
        garantiaMeses: opcional(entero(1, 120)),
      }),
      1,
    ),
    pagos: arreglo(
      objeto({
        medio: medioPago,
        moneda,
        monto: entero(1),
        recibido: opcional(centavos),
        cambio: opcional(centavos),
        referencia: opcional(texto),
      }),
      1,
    ),
    cliente: opcional(objeto({ nombre: texto, telefono: opcional(texto) })),
  },
  (d) => {
    const c = errorMonedaCotizacion(d);
    if (c !== null) return c;
    const s = errorSeriesLineas(d.lineas, 'datos.lineas');
    if (s !== null) return s;
    let neto = 0;
    for (const [i, p] of d.pagos.entries()) {
      if (p.moneda !== d.moneda) return `datos.pagos[${i}].moneda debe ser la moneda de la venta (cobro en una sola moneda)`;
      const cambio = p.cambio ?? 0;
      if (cambio > 0 && p.medio !== 'efectivo') return `datos.pagos[${i}].cambio solo aplica al efectivo`;
      if (cambio > p.monto) return `datos.pagos[${i}].cambio no puede superar el monto`;
      neto += p.monto - cambio;
    }
    return neto === d.total ? null : 'datos.pagos (menos el cambio) debe sumar el total';
  },
);

const cotizacionClp: CopiaCotizacion<string> = {
  cotizacionId: 'CL-2026-11-04-1',
  par: 'CLP/EUR',
  valor: 1000,
  fecha: '2026-11-04',
  fuente: 'manual',
  estado: 'vigente',
};

const linea = { productoId: 'p1', nombre: 'Licuadora', cantidad: 2, precioUnitario: 10000, almacenId: 'a1', series: ['S1', 'S2'], garantiaMeses: 12 };
const valido: DatosVentaConfirmadaV2 = {
  ventaId: 'v1',
  turnoId: 't1',
  cajaId: 'c1',
  cajeroUid: 'u-caj',
  numeroRecibo: 'A-000001',
  moneda: 'CLP',
  monedaBase: 'EUR',
  total: 20000,
  cotizacion: cotizacionClp,
  lineas: [linea],
  pagos: [{ medio: 'efectivo', moneda: 'CLP', monto: 21000, recibido: 25000, cambio: 1000 }],
  cliente: { nombre: 'Ana Pérez' },
};
const sinCotizacion: DatosVentaConfirmadaV2 = {
  ...valido,
  moneda: 'EUR',
  cotizacion: null,
  pagos: [{ medio: 'qr', moneda: 'EUR', monto: 20000 }],
};

export const fixturesVentaConfirmadaV2: Fixtures<DatosVentaConfirmadaV2> = {
  validos: [
    valido,
    sinCotizacion,
    { ...sinCotizacion, moneda: 'USD', monedaBase: 'USD', pagos: [{ medio: 'qr', moneda: 'USD', monto: 20000 }] },
    { ...valido, moneda: 'BOB', monedaBase: 'USD', cotizacion: { ...cotizacionClp, par: 'BOB/USD', fuente: 'BCB' }, pagos: [{ medio: 'qr', moneda: 'BOB', monto: 20000 }] },
  ],
  invalidos: [
    { nombre: 'moneda con cotización nula y distinta de la base', datos: { ...valido, cotizacion: null } },
    { nombre: 'moneda igual a la base con cotización', datos: { ...sinCotizacion, cotizacion: cotizacionClp } },
    { nombre: 'cotización con par distinto de moneda/base', datos: { ...valido, cotizacion: { ...cotizacionClp, par: 'EUR/CLP' } } },
    { nombre: 'cotización con par de otra moneda', datos: { ...valido, cotizacion: { ...cotizacionClp, par: 'BOB/EUR' } } },
    { nombre: 'sin cotización (clave ausente)', datos: { ...valido, cotizacion: undefined } },
    { nombre: 'sin moneda base', datos: { ...valido, monedaBase: undefined } },
    { nombre: 'moneda base en minúsculas', datos: { ...valido, monedaBase: 'eur' } },
    { nombre: 'moneda de dos letras', datos: { ...valido, moneda: 'CL' } },
    { nombre: 'cotización con par mal formado', datos: { ...valido, cotizacion: { ...cotizacionClp, par: 'CLP-EUR' } } },
    { nombre: 'cotización con valor cero', datos: { ...valido, cotizacion: { ...cotizacionClp, valor: 0 } } },
    { nombre: 'pago en otra moneda', datos: { ...valido, pagos: [{ medio: 'efectivo', moneda: 'EUR', monto: 20000 }] } },
    { nombre: 'pagos no suman el total', datos: { ...valido, pagos: [{ medio: 'qr', moneda: 'CLP', monto: 19999 }] } },
    { nombre: 'cambio en un pago que no es efectivo', datos: { ...valido, pagos: [{ medio: 'qr', moneda: 'CLP', monto: 21000, cambio: 1000 }] } },
    { nombre: 'series que no igualan la cantidad', datos: { ...valido, lineas: [{ ...linea, series: ['S1'] }] } },
    { nombre: 'sin líneas', datos: { ...valido, lineas: [] } },
    { nombre: 'total decimal', datos: { ...valido, total: 10.5 } },
    { nombre: 'sin número de recibo', datos: { ...valido, numeroRecibo: undefined } },
    { nombre: 'campo sobrante', datos: { ...valido, extra: 1 } },
    { nombre: 'no es objeto', datos: 'venta' },
  ],
};
