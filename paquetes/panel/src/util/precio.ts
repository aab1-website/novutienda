import { aCentavos, esReglaRedondeoValida, precioDeMercado, type RedondeoPorMoneda, type ReglaRedondeo } from '@novutienda/nucleo';
import type { CodigoMoneda, MercadoDeclarado } from '../api/tipos.js';

/**
 * Adopta las reglas de redondeo que devolvió el servidor (política del comercio). Usa la validación del núcleo (0, 1 o 2
 * decimales, o un múltiplo de al menos 0,01) y descarta las reglas no admitidas. Sin respuesta, vuelve al estado inicial.
 */
export function fijarRedondeo(r: unknown): void {
  // Una respuesta sin redondeo no deja reglas de otra sesión: vuelve al estado inicial (D21).
  if (typeof r !== 'object' || r === null) { restablecerRedondeo(); return; }
  fijarReglasDeclaradas(r);
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

/** Olvida las reglas recibidas (cambio de negocio o de sesión, y pruebas). */
export const restablecerRedondeo = (): void => {
  reglasDeclaradas = null;
};

export { aCentavos };

export type PrecioMercadoVista =
  | { readonly tipo: 'precio'; readonly centavos: number; readonly moneda: CodigoMoneda }
  | { readonly tipo: 'sin_precio' }
  | { readonly tipo: 'sin_cotizacion' }
  | { readonly tipo: 'sin_redondeo' };

/**
 * Precio de venta en un mercado declarado por el comercio, sobre `precioDeMercado` del núcleo. `baseCentavos` está en la
 * moneda base del mercado. D21: sin una regla de redondeo válida para la moneda de venta (`reglas` nulo o sin esa
 * moneda) no hay precio (`sin_redondeo`); Un mercado con tipo de cambio exige una cotización;
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
