// Lectura del documento `tenants/{t}/productos/{id}` tal como lo escribe Inventarios.
// Inventarios no exporta un lector de productos: este es el único lugar de la plataforma que conoce
// la forma del documento (nombre, activo, conSerie, garantiaMeses, precioUSD{bo,ar}, stockTotal).
import { aCentavos } from '@plataforma/nucleo';

type Datos = Readonly<Record<string, unknown>>;

export const rutaProducto = (tenantId: string, productoId: string): string => `tenants/${tenantId}/productos/${productoId}`;
export const rutaExistencia = (tenantId: string, productoId: string, ubicacionId: string): string =>
  `tenants/${tenantId}/existencias/${productoId}__${ubicacionId}`;

/**
 * Unidad de los precios. Inventarios guarda `precioUSD` en CENTAVOS enteros de USD; la consola y el
 * POS trabajan con USD decimales (`precioFinal` multiplica USD por la cotización). La conversión vive
 * solo aquí.
 */
export const centavosADolares = (centavos: number): number => centavos / 100;
export const dolaresACentavos = (dolares: number): number => aCentavos(dolares);

export interface ProductoInventarios {
  readonly productoId: string;
  readonly nombre: string;
  readonly categoria?: string;
  readonly sku?: string;
  readonly activo: boolean;
  readonly conSerie: boolean;
  readonly garantiaMeses?: number;
  /** Centavos de USD por mercado. */
  readonly precioCentavos: { readonly bo: number; readonly ar: number };
  /** Ausente: el producto no controla stock. */
  readonly stockTotal?: number;
  readonly version: number;
}

const entero = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;

export class ProductoCorrupto extends Error {
  constructor(productoId: string, motivo: string) {
    super(`Producto ${productoId} con datos inválidos: ${motivo}`);
    this.name = 'ProductoCorrupto';
  }
}

/** Valida el documento de producto; lo que no cumple se rechaza, nunca se corrige. */
export function leerDocumentoProducto(productoId: string, d: Datos): ProductoInventarios {
  if (typeof d['nombre'] !== 'string' || d['nombre'] === '') throw new ProductoCorrupto(productoId, 'nombre');
  if (typeof d['activo'] !== 'boolean') throw new ProductoCorrupto(productoId, 'activo');
  if (typeof d['conSerie'] !== 'boolean') throw new ProductoCorrupto(productoId, 'conSerie');
  const p = d['precioUSD'] as Datos | undefined;
  if (typeof p !== 'object' || p === null || !entero(p['bo']) || !entero(p['ar'])) throw new ProductoCorrupto(productoId, 'precioUSD');
  const g = d['garantiaMeses'];
  if (g !== undefined && !entero(g)) throw new ProductoCorrupto(productoId, 'garantiaMeses');
  const s = d['stockTotal'];
  if (s !== undefined && !entero(s)) throw new ProductoCorrupto(productoId, 'stockTotal');
  return {
    productoId,
    nombre: d['nombre'],
    ...(typeof d['categoria'] === 'string' ? { categoria: d['categoria'] } : {}),
    ...(typeof d['sku'] === 'string' ? { sku: d['sku'] } : {}),
    activo: d['activo'],
    conSerie: d['conSerie'],
    ...(g !== undefined ? { garantiaMeses: g as number } : {}),
    precioCentavos: { bo: p['bo'] as number, ar: p['ar'] as number },
    ...(s !== undefined ? { stockTotal: s as number } : {}),
    version: entero(d['version']) ? d['version'] : 0,
  };
}
