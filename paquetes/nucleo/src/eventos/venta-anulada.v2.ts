import { arreglo, cantidadPositiva, crearValidador, entero, errorSeriesLineas, medioPago, moneda, objeto, texto, type Fixtures } from './esquema.js';
import type { LineaVentaAnulada } from './venta-anulada.v1.js';
import type { MedioPagoVenta } from './venta-confirmada.v1.js';

/**
 * Contrato v2 de la anulación: igual que la v1, con reembolsos en cualquier moneda ISO declarada por el tenant.
 * Que la moneda exista en el tenant lo comprueba el servidor (`coherenteConComercial`).
 */
export const TIPO_VENTA_ANULADA_V2 = 'venta.anulada';

export interface ReembolsoVentaV2 {
  readonly medio: MedioPagoVenta;
  readonly moneda: string;
  readonly monto: number;
}

export interface DatosVentaAnuladaV2 {
  readonly ventaId: string;
  readonly turnoId: string;
  readonly motivo: string;
  readonly anuladaPor: string;
  readonly aprobadoPor: string;
  readonly lineas: readonly LineaVentaAnulada[];
  /** Mismas reglas que la v1: a lo sumo uno por medio, nunca `credito`, todos en la misma moneda. */
  readonly reembolsos: readonly ReembolsoVentaV2[];
  readonly turnoIdReembolso: string;
}

export const validarVentaAnuladaV2 = crearValidador<DatosVentaAnuladaV2>(
  {
    ventaId: texto,
    turnoId: texto,
    motivo: texto,
    anuladaPor: texto,
    aprobadoPor: texto,
    lineas: arreglo(objeto({ productoId: texto, cantidad: cantidadPositiva, almacenId: texto, series: arreglo(texto) }), 1),
    reembolsos: arreglo(objeto({ medio: medioPago, moneda, monto: entero(1) })),
    turnoIdReembolso: texto,
  },
  (d) => {
    const medios = new Set<string>();
    for (const [i, r] of d.reembolsos.entries()) {
      if (r.medio === 'credito') return `datos.reembolsos[${i}].medio no puede ser crédito (no se reembolsa lo que no se cobró)`;
      if (r.moneda !== d.reembolsos[0]?.moneda) return `datos.reembolsos[${i}].moneda debe ser la misma en todos los reembolsos`;
      if (medios.has(r.medio)) return `datos.reembolsos[${i}].medio repetido`;
      medios.add(r.medio);
    }
    return errorSeriesLineas(d.lineas, 'datos.lineas');
  },
);

const valido: DatosVentaAnuladaV2 = {
  ventaId: 'v1',
  turnoId: 't1',
  motivo: 'Error de digitación',
  anuladaPor: 'u-caj',
  aprobadoPor: 'u-sup',
  lineas: [{ productoId: 'p1', cantidad: 2, almacenId: 'a1', series: ['S1', 'S2'] }],
  reembolsos: [{ medio: 'efectivo', moneda: 'CLP', monto: 20000 }],
  turnoIdReembolso: 't2',
};

export const fixturesVentaAnuladaV2: Fixtures<DatosVentaAnuladaV2> = {
  validos: [
    valido,
    { ...valido, reembolsos: [] },
    { ...valido, reembolsos: [{ medio: 'efectivo', moneda: 'EUR', monto: 10000 }, { medio: 'qr', moneda: 'EUR', monto: 10000 }] },
  ],
  invalidos: [
    { nombre: 'sin motivo', datos: { ...valido, motivo: undefined } },
    { nombre: 'sin líneas', datos: { ...valido, lineas: [] } },
    { nombre: 'series que no igualan la cantidad', datos: { ...valido, lineas: [{ ...valido.lineas[0], series: ['S1'] }] } },
    { nombre: 'reembolso por crédito', datos: { ...valido, reembolsos: [{ ...valido.reembolsos[0], medio: 'credito' }] } },
    { nombre: 'moneda de reembolso mal formada', datos: { ...valido, reembolsos: [{ ...valido.reembolsos[0], moneda: 'peso' }] } },
    { nombre: 'moneda de reembolso en minúsculas', datos: { ...valido, reembolsos: [{ ...valido.reembolsos[0], moneda: 'clp' }] } },
    { nombre: 'reembolsos en monedas distintas', datos: { ...valido, reembolsos: [valido.reembolsos[0], { medio: 'qr', moneda: 'EUR', monto: 100 }] } },
    { nombre: 'dos reembolsos del mismo medio', datos: { ...valido, reembolsos: [valido.reembolsos[0], valido.reembolsos[0]] } },
    { nombre: 'reembolso de monto cero', datos: { ...valido, reembolsos: [{ ...valido.reembolsos[0], monto: 0 }] } },
    { nombre: 'campo sobrante', datos: { ...valido, extra: true } },
  ],
};
