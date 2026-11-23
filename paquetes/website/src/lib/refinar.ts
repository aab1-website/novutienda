/** «Refinar la búsqueda»: la lógica de los filtros del catálogo (texto, marcas y precio). Pura, sin DOM; la comparten la columna y el panel. */
import { buscarProductos, filtrarProductos } from '../contenido/consultas.js';

export interface Refinado {
  readonly texto: string;
  readonly marcas: readonly string[];
  /** Mínimo y máximo elegidos en la moneda local; `null` = sin filtro de precio. */
  readonly rango: readonly [number, number] | null;
}

export const SIN_FILTROS: Refinado = { texto: '', marcas: [], rango: null };

export const contarFiltros = (f: Refinado): number => (f.texto.trim() !== '' ? 1 : 0) + f.marcas.length + (f.rango !== null ? 1 : 0);

export interface LimitesPrecio {
  readonly min: number;
  readonly max: number;
  readonly paso: number;
}

/** Límites del deslizante tomados de los precios reales (los `null` no cuentan): se ajustan al paso hacia afuera. `null` si no hay rango. */
export function limitesDePrecio(precios: readonly (number | null)[]): LimitesPrecio | null {
  const reales = precios.filter((p): p is number => p !== null && Number.isFinite(p) && p > 0);
  if (reales.length === 0) return null;
  const bajo = Math.min(...reales);
  const alto = Math.max(...reales);
  if (bajo === alto) return null;
  const paso = Math.max(1, 10 ** Math.floor(Math.log10((alto - bajo) / 40)));
  const min = Math.floor(bajo / paso) * paso;
  const max = Math.ceil(alto / paso) * paso;
  return { min, max, paso };
}

/** Aplica los tres filtros sobre toda la lista, conservando el orden del catálogo. */
export function refinar<T extends { readonly nombre: string; readonly marca: string; readonly categoria: string }>(
  items: readonly T[], f: Refinado, precioDe: (item: T) => number | null,
): readonly T[] {
  const porTexto = f.texto.trim() === '' ? items : buscarProductos(items, f.texto, Number.POSITIVE_INFINITY);
  return filtrarProductos(porTexto, { marcas: f.marcas, minimo: f.rango?.[0] ?? null, maximo: f.rango?.[1] ?? null }, precioDe);
}
