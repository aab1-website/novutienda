import { aCentavos, esReglaRedondeoValida, precioDeMercado, precioFinal, type Mercado, type Moneda, type Redondeo, type RedondeoPorMoneda, type ReglaRedondeo } from '@novutienda/nucleo';
import type { CodigoMoneda, CotizacionVista, MercadoDeclarado } from '../api/tipos.js';

/**
 * Redondeo POR DEFECTO de las decisiones de negocio (04/11/2026): BOB a dos decimales; ARS al múltiplo de 100 más cercano.
 * Es solo el respaldo mientras carga: el redondeo vigente es el que devuelve el servidor (`pos.cotizaciones`), que es el
 * que aplica al cobrar; el POS rechaza (`precio-alterado`) cualquier diferencia.
 */
export const REDONDEO: Redondeo = {
  BOB: { tipo: 'decimales', decimales: 2, modo: 'cercano' },
  ARS: { tipo: 'multiplo', multiplo: 100, modo: 'cercano' },
} as Redondeo;

let redondeoVigente: Redondeo = REDONDEO;

/**
 * Fija el redondeo que devolvió el servidor (política del negocio). Usa la validación del núcleo (regla única: 0, 1 o 2
 * decimales, o un múltiplo de al menos 0,01). Si falta una regla o no es admitida (`ninguno`, más de 2 decimales), la
 * ignora por completo y conserva el redondeo anterior.
 */
export function fijarRedondeo(r: unknown): void {
  // Una respuesta sin redondeo no deja reglas de otra sesión: vuelve al estado inicial (D21).
  if (typeof r !== 'object' || r === null) { restablecerRedondeo(); return; }
  const o = r as Record<string, unknown>;
  fijarReglasDeclaradas(r);
  if (esReglaRedondeoValida(o['BOB']) && esReglaRedondeoValida(o['ARS'])) redondeoVigente = r as Redondeo;
}

/**
 * Reglas de redondeo por moneda de venta declarada, tal como las devolvió el servidor. Sin respaldo: mientras no llegó
 * ninguna regla válida, la función nueva de precio no muestra precio (D21). Solo se conservan las reglas válidas.
 */
let reglasDeclaradas: RedondeoPorMoneda | null = null;

/** Adopta las reglas válidas por moneda que devolvió el servidor; ignora las inválidas y no inventa ninguna. */
export function fijarReglasDeclaradas(r: unknown): void {
  if (typeof r !== 'object' || r === null) return;
  const validas: Record<string, ReglaRedondeo> = {};
  for (const [moneda, regla] of Object.entries(r as Record<string, unknown>)) {
    if (esReglaRedondeoValida(regla)) validas[moneda] = regla;
  }
  reglasDeclaradas = validas;
}

/** Reglas por moneda declarada ya recibidas, o `null` si aún no llegaron. */
export const reglasDeclaradasActuales = (): RedondeoPorMoneda | null => reglasDeclaradas;

/** Redondeo en uso: el del servidor si ya llegó; si no, el respaldo por defecto. */
export const redondeoActual = (): Redondeo => redondeoVigente;

/** Vuelve al respaldo por defecto (cambio de negocio o de sesión, y pruebas). */
export const restablecerRedondeo = (): void => {
  redondeoVigente = REDONDEO;
  reglasDeclaradas = null;
};

export const MONEDA_DE_MERCADO: Readonly<Record<Mercado, Moneda>> = { BO: 'BOB', AR: 'ARS' };

export type PrecioVista =
  | { readonly tipo: 'precio'; readonly centavos: number; readonly moneda: Moneda }
  | { readonly tipo: 'sin_precio' }
  | { readonly tipo: 'sin_cotizacion' };

/**
 * Precio de venta en la moneda elegida. USD: el precio base en centavos. BOB/ARS: `precioFinal` del núcleo (la misma
 * función del sitio y del servidor) con la cotización vigente del mercado.
 */
export function precioDeVenta(usdCentavos: number, mercado: Mercado, moneda: Moneda, cotizacion: CotizacionVista | null): PrecioVista {
  if (usdCentavos <= 0) return { tipo: 'sin_precio' };
  if (moneda === 'USD') return { tipo: 'precio', centavos: usdCentavos, moneda };
  if (cotizacion === null) return { tipo: 'sin_cotizacion' };
  const r = precioFinal(usdCentavos / 100, mercado, { par: cotizacion.par, valor: cotizacion.valor }, redondeoVigente);
  if (r.tipo === 'sin_precio') return { tipo: 'sin_precio' };
  if (r.tipo === 'invalido') return { tipo: 'sin_cotizacion' };
  return { tipo: 'precio', centavos: r.centavos, moneda: r.moneda };
}

export { aCentavos };

export type PrecioMercadoVista =
  | { readonly tipo: 'precio'; readonly centavos: number; readonly moneda: CodigoMoneda }
  | { readonly tipo: 'sin_precio' }
  | { readonly tipo: 'sin_cotizacion' }
  | { readonly tipo: 'sin_redondeo' };

/**
 * Precio de venta en un mercado declarado por el comercio, sobre `precioDeMercado` del núcleo. `baseCentavos` está en la
 * moneda base del mercado. D21: sin una regla de redondeo válida para la moneda de venta (`reglas` nulo o sin esa
 * moneda) no hay precio (`sin_redondeo`); no usa el respaldo fijo. Un mercado con tipo de cambio exige una cotización;
 * si falta o no corresponde, `sin_cotizacion`. Base 0 es `sin_precio` (a consultar), nunca gratis.
 */
export function precioDeVentaMercado(
  baseCentavos: number,
  mercado: MercadoDeclarado,
  cotizacion: { readonly par: string; readonly valor: number } | null,
  reglas: RedondeoPorMoneda | null = reglasDeclaradas,
): PrecioMercadoVista {
  if (!Number.isFinite(baseCentavos) || baseCentavos <= 0) return { tipo: 'sin_precio' };
  const regla = reglas?.[mercado.monedaVenta];
  if (!esReglaRedondeoValida(regla)) return { tipo: 'sin_redondeo' };
  if (mercado.tieneTipoCambio && cotizacion === null) return { tipo: 'sin_cotizacion' };
  const r = precioDeMercado(
    baseCentavos / 100,
    {
      id: mercado.id, monedaVenta: mercado.monedaVenta, monedaBase: mercado.monedaBase, redondeo: regla,
      tipoCambio: mercado.tieneTipoCambio ? { par: `${mercado.monedaVenta}/${mercado.monedaBase}`, fuentes: [] } : null,
    },
    cotizacion,
  );
  if (r.tipo === 'sin_precio') return { tipo: 'sin_precio' };
  if (r.tipo === 'invalido') return { tipo: 'sin_cotizacion' };
  return { tipo: 'precio', centavos: r.centavos, moneda: r.moneda };
}
