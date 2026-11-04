// Lectores públicos del documento de producto y de las existencias, tal como los escribe este módulo. Los
// adaptadores (consola, POS) los usan en lugar de conocer rutas y campos.
import type { TransaccionMin } from '@plataforma/nucleo';
import { idExistencia, ruta, UBICACIONES, type UbicacionId } from './ids.js';

type Datos = Readonly<Record<string, unknown>>;

/** Producto leído y validado. `precioCentavos` es USD en CENTAVOS enteros (la conversión a decimales es de los adaptadores). */
export interface ProductoLeido {
  readonly productoId: string;
  readonly nombre: string;
  readonly categoria?: string;
  readonly marca?: string;
  readonly sku?: string;
  readonly activo: boolean;
  readonly publicado: boolean;
  readonly conSerie: boolean;
  readonly garantiaMeses?: number;
  readonly minimo?: number;
  /** Centavos de USD por mercado. */
  readonly precioCentavos: { readonly bo: number; readonly ar: number };
  /** Ausente: el producto no controla stock. */
  readonly stockTotal?: number;
  readonly version: number;
}

export interface ExistenciaLeida {
  readonly ubicacionId: UbicacionId;
  readonly cantidad: number;
}

const entero = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;

export class ProductoCorrupto extends Error {
  constructor(productoId: string, motivo: string) {
    super(`Producto ${productoId} con datos inválidos: ${motivo}`);
    this.name = 'ProductoCorrupto';
  }
}

export const rutaColeccionProductos = (tenantId: string): string => `tenants/${tenantId}/productos`;

/** Valida el documento de producto; lo que no cumple se rechaza, nunca se corrige. */
export function leerDocumentoProducto(productoId: string, d: Datos): ProductoLeido {
  if (typeof d['nombre'] !== 'string' || d['nombre'] === '') throw new ProductoCorrupto(productoId, 'nombre');
  if (typeof d['activo'] !== 'boolean') throw new ProductoCorrupto(productoId, 'activo');
  if (typeof d['conSerie'] !== 'boolean') throw new ProductoCorrupto(productoId, 'conSerie');
  const p = d['precioUSD'] as Datos | undefined;
  if (typeof p !== 'object' || p === null || !entero(p['bo']) || !entero(p['ar'])) throw new ProductoCorrupto(productoId, 'precioUSD');
  const g = d['garantiaMeses'];
  if (g !== undefined && !entero(g)) throw new ProductoCorrupto(productoId, 'garantiaMeses');
  const m = d['minimo'];
  if (m !== undefined && !entero(m)) throw new ProductoCorrupto(productoId, 'minimo');
  const s = d['stockTotal'];
  if (s !== undefined && !entero(s)) throw new ProductoCorrupto(productoId, 'stockTotal');
  return {
    productoId,
    nombre: d['nombre'],
    ...(typeof d['categoria'] === 'string' ? { categoria: d['categoria'] } : {}),
    ...(typeof d['marca'] === 'string' ? { marca: d['marca'] } : {}),
    ...(typeof d['sku'] === 'string' ? { sku: d['sku'] } : {}),
    activo: d['activo'],
    publicado: d['publicado'] === true,
    conSerie: d['conSerie'],
    ...(g !== undefined ? { garantiaMeses: g as number } : {}),
    ...(m !== undefined ? { minimo: m as number } : {}),
    precioCentavos: { bo: p['bo'] as number, ar: p['ar'] as number },
    ...(s !== undefined ? { stockTotal: s as number } : {}),
    version: entero(d['version']) ? d['version'] : 0,
  };
}

/** Lee un producto dentro de la transacción del llamador. `undefined` si no existe. */
export async function leerProducto(
  tx: Pick<TransaccionMin, 'get'>,
  tenantId: string,
  productoId: string,
): Promise<ProductoLeido | undefined> {
  const d = await tx.get(ruta(tenantId, 'productos', productoId));
  const datos = d.data();
  return d.existe && datos !== undefined ? leerDocumentoProducto(productoId, datos) : undefined;
}

/** Existencias por almacén de un producto (solo las que existen), en el orden de `UBICACIONES`. */
export async function leerExistencias(
  tx: Pick<TransaccionMin, 'get'>,
  tenantId: string,
  productoId: string,
): Promise<ExistenciaLeida[]> {
  const salida: ExistenciaLeida[] = [];
  for (const u of UBICACIONES) {
    const d = await tx.get(ruta(tenantId, 'existencias', idExistencia(productoId, u)));
    const cantidad = d.data()?.['cantidad'];
    if (d.existe && typeof cantidad === 'number') salida.push({ ubicacionId: u, cantidad });
  }
  return salida;
}
