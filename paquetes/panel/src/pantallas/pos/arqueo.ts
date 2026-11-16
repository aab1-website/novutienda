import { esReglaRedondeoValida, type RedondeoPorMoneda } from '@novutienda/nucleo';
import type { CotizacionesVigentes, MercadoDeclarado, MontosPorMoneda, PreciosPorMercado, ProductoPanel, TotalesMoneda, TotalesTurno, TurnoPos } from '../../api/tipos.js';
import { precioDeVentaMercado, reglasDeclaradasActuales, type PrecioMercadoVista } from '../../util/precio.js';

export const TOTALES_VACIOS: TotalesMoneda = { efectivo: 0, qr: 0, transferencia: 0, credito: 0, ingresos: 0, egresos: 0 };

/** Efectivo esperado: apertura + efectivo neto + ingresos − egresos (QR, transferencia y crédito nunca suman). */
export const efectivoEsperado = (apertura: number, t: TotalesMoneda): number => apertura + t.efectivo + t.ingresos - t.egresos;

/**
 * Códigos en orden estable. Con `orden` (las monedas de caja declaradas por el comercio) primero van esas, en ese orden;
 * sin él, o para las que no estén en él, orden alfabético por código.
 */
export function ordenarMonedas(codigos: Iterable<string>, orden: readonly string[] = []): string[] {
  const todos = new Set(codigos);
  const conocidas: string[] = orden.filter((m, i) => todos.has(m) && orden.indexOf(m) === i);
  const otras = [...todos].filter((m) => !conocidas.includes(m)).sort();
  return [...conocidas, ...otras];
}

export function monedasDelTurno(t: Pick<TurnoPos, 'apertura' | 'totales'>, orden: readonly string[]): string[] {
  const hay = (r: Readonly<Partial<Record<string, unknown>>>): string[] => Object.keys(r).filter((m) => r[m] !== undefined);
  return ordenarMonedas([...hay(t.apertura), ...hay(t.totales)], orden);
}

export interface ProyeccionMoneda {
  readonly apertura: number;
  readonly efectivoEsperado: number;
  readonly qr: number;
  readonly transferencia: number;
  readonly credito: number;
  readonly ingresos: number;
  readonly egresos: number;
}

/** Supervisión en vivo: proyección por moneda (misma fórmula que el servidor). */
export function proyectarTurno(t: Pick<TurnoPos, 'apertura' | 'totales'>, orden: readonly string[]): Partial<Record<string, ProyeccionMoneda>> {
  const r: Partial<Record<string, ProyeccionMoneda>> = {};
  for (const m of monedasDelTurno(t, orden)) {
    const x = t.totales[m] ?? TOTALES_VACIOS;
    const apertura = t.apertura[m] ?? 0;
    r[m] = { apertura, efectivoEsperado: efectivoEsperado(apertura, x), qr: x.qr, transferencia: x.transferencia, credito: x.credito, ingresos: x.ingresos, egresos: x.egresos };
  }
  return r;
}

/** Diferencia = contado − esperado, SIN tope en cero (una falta queda negativa). */
export function diferenciaPorMoneda(t: Pick<TurnoPos, 'apertura' | 'totales'>, contado: MontosPorMoneda, orden: readonly string[]): Partial<Record<string, number>> {
  const r: Partial<Record<string, number>> = {};
  const p = proyectarTurno(t, orden);
  for (const m of ordenarMonedas(Object.keys(contado), orden)) {
    const c = contado[m];
    const e = p[m];
    if (c !== undefined && e !== undefined) r[m] = c - e.efectivoEsperado;
  }
  return r;
}

/** Suma `delta` a los totales de una moneda (devuelve un objeto nuevo). */
export function sumarTotales(totales: TotalesTurno, moneda: string, delta: Partial<TotalesMoneda>): TotalesTurno {
  const b = totales[moneda] ?? TOTALES_VACIOS;
  return {
    ...totales,
    [moneda]: {
      efectivo: b.efectivo + (delta.efectivo ?? 0), qr: b.qr + (delta.qr ?? 0), transferencia: b.transferencia + (delta.transferencia ?? 0),
      credito: b.credito + (delta.credito ?? 0), ingresos: b.ingresos + (delta.ingresos ?? 0), egresos: b.egresos + (delta.egresos ?? 0),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Mercados y monedas declarados por el comercio (lo que la caja ofrece y cómo calcula el precio mostrado)
// ---------------------------------------------------------------------------------------------------------------------

/** Monedas en que se puede cobrar en un mercado (D19): su moneda de venta y, si es distinta, su moneda base; en ese orden. */
export const monedasDeCobro = (m: Pick<MercadoDeclarado, 'monedaVenta' | 'monedaBase'>): string[] =>
  m.monedaVenta === m.monedaBase ? [m.monedaVenta] : [m.monedaVenta, m.monedaBase];

/** Cotización vigente de un mercado declarado, buscada por su id (las cotizaciones se indexan por el id del mercado declarado; sin entrada, null). */
export const cotizacionDeMercado = (cot: CotizacionesVigentes, id: string): CotizacionesVigentes[string] =>
  cot[id] ?? null;

/** Precio base del producto (centavos de la moneda base) en un mercado declarado; 0 si no tiene precio ahí. */
export const precioBaseDeMercado = (p: Pick<ProductoPanel, 'precioUSD'>, id: string): number =>
  (p.precioUSD as unknown as PreciosPorMercado)[id.toLowerCase()] ?? 0;

/** Verdadero si hay una regla de redondeo válida para la moneda de venta del mercado (D21: sin ella no se muestra precio). */
export const hayReglaDeRedondeo = (m: Pick<MercadoDeclarado, 'monedaVenta'>): boolean => esReglaRedondeoValida(reglasDeclaradasActuales()?.[m.monedaVenta]);

/**
 * Precio de un producto en el mercado y la moneda de cobro elegidos. En un mercado CON tipo de cambio, la moneda base es el
 * precio base sin conversión; en uno SIN tipo de cambio el servidor redondea siempre con la regla de la moneda de venta
 * (`centavosDeLinea`), así que el panel hace lo mismo. En la moneda de venta aplica `precioDeVentaMercado` (cotización y regla de redondeo del comercio, sin respaldo fijo).
 */
export function precioDeCobro(p: Pick<ProductoPanel, 'precioUSD'>, mercado: MercadoDeclarado, moneda: string, cot: CotizacionesVigentes, reglas: RedondeoPorMoneda | null = reglasDeclaradasActuales()): PrecioMercadoVista {
  const base = precioBaseDeMercado(p, mercado.id);
  if (mercado.tieneTipoCambio && moneda === mercado.monedaBase && moneda !== mercado.monedaVenta) return base > 0 ? { tipo: 'precio', centavos: base, moneda } : { tipo: 'sin_precio' };
  const c = cotizacionDeMercado(cot, mercado.id);
  const r = precioDeVentaMercado(base, mercado, c === null ? null : { par: c.par, valor: c.valor }, reglas);
  // Sin tipo de cambio y cobrando en la moneda base: el monto redondeado se cobra en la moneda elegida.
  return r.tipo === 'precio' && !mercado.tieneTipoCambio ? { ...r, moneda } : r;
}
