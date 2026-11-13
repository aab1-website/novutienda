/**
 * Precio final de un mercado. Con tipo de cambio: precio base × cotización del mercado, redondeado según la regla
 * del mercado. Sin tipo de cambio (moneda base = moneda de venta): el precio base redondeado con la regla del
 * mercado y marcado `sinCotizacion: true`; no hay cotización que guardar. Devuelve el monto decimal y los
 * `centavos` enteros (los eventos guardan centavos). Base 0 es «sin precio / a consultar», nunca «gratis».
 */
import type { MercadoTenant } from '../tenant/mercados.js';
import { esReglaRedondeoValida, type ModoRedondeo, type ReglaRedondeo } from './regla-redondeo.js';
import { MONEDA_DE, PAR_DE, type Mercado, type Moneda } from './tipos.js';

export type { ModoRedondeo, ReglaRedondeo } from './regla-redondeo.js';

/** Redondeo del tenant de tres monedas (LEGADO): una regla por moneda de venta. */
export type Redondeo = Readonly<Record<Moneda, ReglaRedondeo>>;

/** Redondeo parcial por moneda: solo hace falta la regla de las monedas de venta. */
export type RedondeoPorMoneda = Readonly<Record<string, ReglaRedondeo>>;

export type PrecioFinal =
  /** Hay precio calculado. */
  | { readonly tipo: 'precio'; readonly moneda: Moneda; readonly monto: number; readonly centavos: number }
  /** Precio base 0: no es «gratis», es «sin precio / a consultar». */
  | { readonly tipo: 'sin_precio' }
  | { readonly tipo: 'invalido'; readonly motivo: string };

/** Resultado de `precioDeMercado`: como `PrecioFinal` con cualquier moneda ISO; `sinCotizacion` solo aparece (en `true`) si el mercado no tiene tipo de cambio. */
export type PrecioDeMercado =
  | { readonly tipo: 'precio'; readonly moneda: string; readonly monto: number; readonly centavos: number; readonly sinCotizacion?: true }
  | { readonly tipo: 'sin_precio' }
  | { readonly tipo: 'invalido'; readonly motivo: string };

const aplicar = (x: number, modo: ModoRedondeo): number =>
  modo === 'arriba' ? Math.ceil(x) : modo === 'abajo' ? Math.floor(x) : Math.round(x);
/** Quita el ruido de coma flotante (p. ej. 1.005 * 100 = 100.49999999999999). */
const limpiar = (x: number): number => Number(x.toPrecision(12));

/**
 * ÚNICA conversión de un monto decimal a centavos ENTEROS (los eventos usan
 * centavos). Redondea al centavo más cercano tras quitar el ruido de coma
 * flotante; lanza si el resultado no es un entero seguro.
 */
export function aCentavos(monto: number): number {
  const c = Math.round(limpiar(monto * 100));
  if (!Number.isSafeInteger(c)) throw new RangeError('el monto no es convertible a centavos enteros');
  return c;
}

export function redondear(monto: number, regla: ReglaRedondeo): number {
  if (regla.tipo === 'ninguno') return limpiar(monto);
  if (regla.tipo === 'decimales') {
    const f = 10 ** regla.decimales;
    return aplicar(limpiar(monto * f), regla.modo) / f;
  }
  return limpiar(aplicar(limpiar(monto / regla.multiplo), regla.modo) * regla.multiplo);
}

interface Entrada {
  readonly idMercado: string;
  readonly moneda: string;
  readonly monedaBase: string;
  /** Par esperado `VENTA/BASE`, o `null` si el mercado no tiene tipo de cambio. */
  readonly par: string | null;
  readonly regla: ReglaRedondeo | undefined;
}

function calcular(base: number, e: Entrada, cotizacion: { readonly par: string; readonly valor: number } | null): PrecioDeMercado {
  if (typeof base !== 'number' || !Number.isFinite(base) || base < 0) return { tipo: 'invalido', motivo: `el precio base en ${e.monedaBase} debe ser un número no negativo` };
  if (base === 0) return { tipo: 'sin_precio' };
  if (e.par !== null) {
    if (cotizacion === null) return { tipo: 'invalido', motivo: `falta la cotización del mercado ${e.idMercado}` };
    if (cotizacion.par !== e.par) return { tipo: 'invalido', motivo: `la cotización ${cotizacion.par} no corresponde al mercado ${e.idMercado}` };
    if (!Number.isFinite(cotizacion.valor) || cotizacion.valor <= 0) return { tipo: 'invalido', motivo: 'el valor de la cotización debe ser positivo' };
  }
  if (!esReglaRedondeoValida(e.regla)) return { tipo: 'invalido', motivo: `falta una regla de redondeo válida para ${e.moneda}` };
  const monto = redondear(e.par === null ? base : base * (cotizacion as { valor: number }).valor, e.regla as ReglaRedondeo);
  if (monto <= 0) return { tipo: 'invalido', motivo: 'el redondeo dejó el precio en cero' };
  if (!Number.isSafeInteger(Math.round(limpiar(monto * 100)))) return { tipo: 'invalido', motivo: 'el precio es demasiado grande' };
  const p = { tipo: 'precio' as const, moneda: e.moneda, monto, centavos: aCentavos(monto) };
  return e.par === null ? { ...p, sinCotizacion: true } : p;
}

/**
 * Precio final en un mercado declarado por el tenant. Con tipo de cambio exige una cotización cuyo par sea el del
 * mercado; sin él, ignora la cotización: el resultado es el precio base redondeado, con `sinCotizacion: true`.
 */
export function precioDeMercado(
  base: number,
  mercado: Pick<MercadoTenant, 'id' | 'monedaVenta' | 'monedaBase' | 'tipoCambio' | 'redondeo'>,
  cotizacion: { readonly par: string; readonly valor: number } | null,
): PrecioDeMercado {
  return calcular(base, { idMercado: mercado.id, moneda: mercado.monedaVenta, monedaBase: mercado.monedaBase, par: mercado.tipoCambio?.par ?? null, regla: mercado.redondeo }, cotizacion);
}

/**
 * LEGADO (tenant de tres monedas): precio base en USD por mercado BO|AR con el redondeo por moneda.
 * @deprecated Usar `precioDeMercado` con el mercado declarado por el tenant.
 */
export function precioFinal(
  usd: number,
  mercado: Mercado,
  cotizacion: { readonly par: string; readonly valor: number },
  redondeo: RedondeoPorMoneda,
): PrecioFinal {
  const moneda = MONEDA_DE[mercado];
  return calcular(usd, { idMercado: mercado, moneda, monedaBase: 'USD', par: PAR_DE[mercado], regla: redondeo[moneda] }, cotizacion) as PrecioFinal;
}
