import { aCsv } from './csv.js';
import type { ProductoCatalogo } from './puertos.js';

export const COLUMNAS_EXPORTACION = ['id', 'nombre', 'categoria', 'marca', 'sku', 'activo', 'garantiaMeses', 'precioBO', 'precioAR'] as const;

/** Exporta el catálogo a CSV (UTF-8 con BOM para Excel). Neutraliza fórmulas; no incluye stock ni costos. */
export function exportarProductosCsv(productos: readonly ProductoCatalogo[]): string {
  const filas = productos.map((p) => [
    p.id, p.nombre, p.categoria, p.marca ?? '', p.sku ?? '', p.activo ? 'si' : 'no',
    p.garantiaMeses === undefined ? '' : String(p.garantiaMeses), String(p.precioUSD.bo), String(p.precioUSD.ar),
  ]);
  return `\uFEFF${aCsv([COLUMNAS_EXPORTACION, ...filas])}`;
}
