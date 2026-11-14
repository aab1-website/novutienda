import { aCentavos, precioDeMercado, type MercadoTenant, type PrecioDeMercado, type ReglaRedondeo, type RedondeoPorMoneda } from '@novutienda/nucleo';
import { ErrorPos } from './errores.js';

function centavosDe(p: PrecioDeMercado): number {
  if (p.tipo === 'sin_precio') throw new ErrorPos('sin-precio', 'El producto no tiene precio (a consultar)');
  if (p.tipo === 'invalido') throw new ErrorPos('sin-precio', `No se pudo calcular el precio: ${p.motivo}`);
  return p.centavos;
}

export interface EntradaPrecioLinea {
  readonly mercado: MercadoTenant;
  /** Moneda de la venta: la de venta del mercado o su moneda base (ya validada contra el comercio). */
  readonly moneda: string;
  /** Precio base decimal del producto en la moneda base del mercado; `undefined` = sin precio en ese mercado. */
  readonly base: number | undefined;
  readonly nombre: string;
  /** Cotización vigente; solo se usa si el mercado tiene tipo de cambio y se vende en su moneda de venta. */
  readonly cotizacion: { readonly par: string; readonly valor: number } | null;
  readonly redondeo: RedondeoPorMoneda;
}

/** Regla de redondeo efectiva (la política del comercio) de la moneda de venta del mercado; sin ella, falla cerrado. */
function reglaEfectiva(e: EntradaPrecioLinea): ReglaRedondeo {
  const regla = e.redondeo[e.mercado.monedaVenta];
  if (regla === undefined) throw new ErrorPos('dato-corrupto', `No hay regla de redondeo para ${e.mercado.monedaVenta} en el comercio`);
  return regla;
}

/**
 * Precio unitario de una línea, en centavos enteros (función pura).
 * - Sin precio en el mercado: `sin-precio` con el nombre del producto y del mercado.
 * - Mercado sin tipo de cambio: el precio base redondeado con la regla efectiva de la moneda de venta (`redondeo`).
 * - Venta en la moneda base: el precio base tal cual (`aCentavos`), sin redondeo ni cotización.
 * - Otro caso: precio base × cotización con la regla de redondeo de la moneda de venta.
 */
export function centavosDeLinea(e: EntradaPrecioLinea): number {
  const { mercado, base } = e;
  if (base === undefined) throw new ErrorPos('sin-precio', `El producto «${e.nombre}» no tiene precio en ${mercado.nombre}; complételo en Inventarios`);
  if (mercado.tipoCambio === null) return centavosDe(precioDeMercado(base, { ...mercado, redondeo: reglaEfectiva(e) }, null));
  if (e.moneda === mercado.monedaBase) {
    if (!Number.isFinite(base) || base <= 0) throw new ErrorPos('sin-precio', 'El producto no tiene precio (a consultar)');
    return aCentavos(base);
  }
  if (e.cotizacion === null) throw new ErrorPos('dato-corrupto', 'Falta la cotización');
  return centavosDe(precioDeMercado(base, { ...mercado, redondeo: reglaEfectiva(e) }, { par: e.cotizacion.par, valor: e.cotizacion.valor }));
}
