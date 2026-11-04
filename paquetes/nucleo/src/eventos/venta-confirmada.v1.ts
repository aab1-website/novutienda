import type { CopiaCotizacion } from '../tipo-cambio/tipos.js';
import {
  arreglo, cantidadPositiva, centavos, copiaCotizacion, crearValidador, entero, errorSeriesLineas, medioPago, monedaOperativa,
  objeto, oNulo, opcional, texto, type Fixtures,
} from './esquema.js';

/**
 * CONTRATO CONGELADO al terminar la ola 1c: desde entonces cualquier cambio
 * incompatible exige un contrato v2 nuevo.
 */
export const TIPO_VENTA_CONFIRMADA_V1 = 'venta.confirmada';

export type MedioPagoVenta = 'efectivo' | 'qr' | 'transferencia' | 'credito';

export interface LineaVentaConfirmada {
  readonly productoId: string;
  readonly cantidad: number;
  /** Enteros de centavos de la moneda de la venta. */
  readonly precioUnitario: number;
  readonly almacenId: string;
  /** Vacío si el producto no se controla por serie; si no, una por unidad. */
  readonly series: readonly string[];
  readonly garantiaMeses?: number;
}

export interface DescuentoVenta {
  /** Enteros de centavos de la moneda de la venta. */
  readonly monto: number;
  readonly motivo: string;
  /** Obligatorio cuando el descuento supera el tope; el tope lo valida el POS, no el contrato. */
  readonly aprobadoPor?: string;
}

export interface PagoVenta {
  readonly medio: MedioPagoVenta;
  readonly moneda: string;
  /** Importe cobrado en este pago (centavos); el cambio se resta del total de pagos. */
  readonly monto: number;
  readonly recibido?: number;
  /** Solo en efectivo. */
  readonly cambio?: number;
  readonly referencia?: string;
}

/** Datos personales mínimos, solo para imprimir o enviar el recibo; no deben registrarse en logs. */
export interface ClienteVenta {
  readonly nombre: string;
  readonly telefono?: string;
}

export interface DatosVentaConfirmadaV1 {
  readonly ventaId: string;
  readonly turnoId: string;
  readonly cajaId: string;
  readonly cajeroUid: string;
  /** Moneda de venta: precios, descuento, total y pagos están en ella. */
  readonly moneda: string;
  /** Total en enteros de centavos. */
  readonly total: number;
  /** Obligatoria si la moneda no es USD; `null` si la venta es toda en USD. */
  readonly cotizacion: CopiaCotizacion | null;
  readonly descuento?: DescuentoVenta;
  readonly lineas: readonly LineaVentaConfirmada[];
  readonly pagos: readonly PagoVenta[];
  readonly cliente?: ClienteVenta;
}

const PAR_DE_MONEDA: Readonly<Record<string, string>> = { BOB: 'BOB/USD', ARS: 'ARS/USD' };

export const validarVentaConfirmadaV1 = crearValidador<DatosVentaConfirmadaV1>(
  {
    ventaId: texto,
    turnoId: texto,
    cajaId: texto,
    cajeroUid: texto,
    moneda: monedaOperativa,
    total: centavos,
    cotizacion: oNulo(copiaCotizacion),
    descuento: opcional(objeto({ monto: entero(1), motivo: texto, aprobadoPor: opcional(texto) })),
    lineas: arreglo(
      objeto({
        productoId: texto,
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
        moneda: monedaOperativa,
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
    if (d.moneda === 'USD') {
      if (d.cotizacion !== null) return 'datos.cotizacion debe ser null si la venta es toda en USD';
    } else {
      if (d.cotizacion === null) return 'datos.cotizacion es obligatoria si algún monto no está en USD';
      if (d.cotizacion.par !== PAR_DE_MONEDA[d.moneda]) return `datos.cotizacion.par no corresponde a la moneda ${d.moneda}`;
    }
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

const cotizacionBob: CopiaCotizacion = {
  cotizacionId: 'BO-2026-11-04-1',
  par: 'BOB/USD',
  valor: 6.96,
  fecha: '2026-11-04',
  fuente: 'BCB',
  estado: 'vigente',
};

const valido: DatosVentaConfirmadaV1 = {
  ventaId: 'v1',
  turnoId: 't1',
  cajaId: 'c1',
  cajeroUid: 'u-caj',
  moneda: 'BOB',
  total: 125000,
  cotizacion: cotizacionBob,
  descuento: { monto: 5000, motivo: 'Cliente frecuente', aprobadoPor: 'u-sup' },
  lineas: [
    { productoId: 'p1', cantidad: 2, precioUnitario: 65000, almacenId: 'a1', series: ['S1', 'S2'], garantiaMeses: 12 },
  ],
  pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 130000, recibido: 150000, cambio: 5000, referencia: 'caja-1' }],
  cliente: { nombre: 'Ana Pérez', telefono: '70000000' },
};

const lineaSinSerie = { productoId: 'p2', cantidad: 1, precioUnitario: 10000, almacenId: 'a1', series: [] };
const ventaUsd: DatosVentaConfirmadaV1 = {
  ventaId: 'v2',
  turnoId: 't1',
  cajaId: 'c1',
  cajeroUid: 'u-caj',
  moneda: 'USD',
  total: 10000,
  cotizacion: null,
  lineas: [lineaSinSerie],
  pagos: [{ medio: 'qr', moneda: 'USD', monto: 10000 }],
};

export const fixturesVentaConfirmadaV1: Fixtures<DatosVentaConfirmadaV1> = {
  validos: [valido, ventaUsd, { ...ventaUsd, moneda: 'ARS', cotizacion: { ...cotizacionBob, par: 'ARS/USD', fuente: 'BNA' }, pagos: [{ medio: 'transferencia', moneda: 'ARS', monto: 10000 }] }],
  invalidos: [
    { nombre: 'total decimal', datos: { ...valido, total: 10.5 } },
    { nombre: 'total negativo', datos: { ...valido, total: -1 } },
    { nombre: 'sin líneas', datos: { ...valido, lineas: [] } },
    { nombre: 'cantidad cero', datos: { ...valido, lineas: [{ ...lineaSinSerie, cantidad: 0 }] } },
    { nombre: 'sin cotización (clave ausente)', datos: { ...ventaUsd, moneda: 'BOB', cotizacion: undefined } },
    { nombre: 'moneda no USD con cotización nula', datos: { ...ventaUsd, moneda: 'BOB', pagos: [{ medio: 'qr', moneda: 'BOB', monto: 10000 }] } },
    { nombre: 'venta en USD con cotización', datos: { ...ventaUsd, cotizacion: cotizacionBob } },
    { nombre: 'cotización con par de otra moneda', datos: { ...valido, cotizacion: { ...cotizacionBob, par: 'ARS/USD' } } },
    { nombre: 'cotización con forma propia antigua', datos: { ...valido, cotizacion: { id: 'c1', par: 'USD/BOB', valor: 6.96, fecha: '2026-11-04T12:00:00Z', fuente: 'BCB', estado: 'vigente' } } },
    { nombre: 'fecha de cotización inexistente', datos: { ...valido, cotizacion: { ...cotizacionBob, fecha: '2026-02-30' } } },
    { nombre: 'moneda en minúsculas', datos: { ...valido, moneda: 'bob' } },
    { nombre: 'campo sobrante', datos: { ...valido, extra: 1 } },
    { nombre: 'no es objeto', datos: 'venta' },
    { nombre: 'sin caja', datos: { ...valido, cajaId: undefined } },
    { nombre: 'sin cajero', datos: { ...valido, cajeroUid: '' } },
    { nombre: 'series menos que la cantidad', datos: { ...valido, lineas: [{ ...valido.lineas[0], series: ['S1'] }] } },
    { nombre: 'series repetidas en la línea', datos: { ...valido, lineas: [{ ...valido.lineas[0], series: ['S1', 'S1'] }] } },
    {
      nombre: 'serie repetida entre líneas',
      datos: {
        ...valido,
        total: 125000,
        lineas: [
          { ...valido.lineas[0], cantidad: 1, series: ['S1'] },
          { ...valido.lineas[0], productoId: 'p3', cantidad: 1, series: ['S1'] },
        ],
      },
    },
    { nombre: 'precio decimal', datos: { ...valido, lineas: [{ ...valido.lineas[0], precioUnitario: 1.5 }] } },
    { nombre: 'garantía cero meses', datos: { ...valido, lineas: [{ ...valido.lineas[0], garantiaMeses: 0 }] } },
    { nombre: 'descuento sin motivo', datos: { ...valido, descuento: { monto: 100 } } },
    { nombre: 'sin pagos', datos: { ...valido, pagos: [] } },
    { nombre: 'medio de pago desconocido', datos: { ...valido, pagos: [{ medio: 'cheque', moneda: 'BOB', monto: 125000 }] } },
    { nombre: 'pago en otra moneda', datos: { ...valido, pagos: [{ medio: 'efectivo', moneda: 'USD', monto: 125000 }] } },
    { nombre: 'pagos mezclan monedas', datos: { ...valido, pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 100000 }, { medio: 'qr', moneda: 'USD', monto: 25000 }] } },
    { nombre: 'pagos no suman el total', datos: { ...valido, pagos: [{ medio: 'qr', moneda: 'BOB', monto: 124999 }] } },
    { nombre: 'pagos suman el total sin restar el cambio', datos: { ...valido, pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 130000, cambio: 0 }] } },
    { nombre: 'cambio en un pago que no es efectivo', datos: { ...valido, pagos: [{ medio: 'qr', moneda: 'BOB', monto: 130000, cambio: 5000 }] } },
    { nombre: 'cambio mayor que el monto', datos: { ...valido, total: 0, pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 100, cambio: 200 }] } },
    { nombre: 'cliente sin nombre', datos: { ...valido, cliente: { telefono: '70000000' } } },
  ],
};
