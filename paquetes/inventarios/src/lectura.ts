// Lectores públicos del documento de producto y de las existencias, tal como los escribe este módulo. Los
// adaptadores (consola, POS) los usan en lugar de conocer rutas y campos.
import type { ConfiguracionComercial, TransaccionMin } from '@novutienda/nucleo';
import { claveDePrecio } from './comercial.js';
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
  /** Centavos de la moneda base de cada mercado (USD en el tenant de tres monedas), por `claveDePrecio(idMercado)`. */
  readonly precioCentavos: PreciosCentavos;
  /** Ausente: el producto no controla stock. */
  readonly stockTotal?: number;
  readonly version: number;
}

/**
 * Precios por clave de mercado. TRANSITORIO: `bo` y `ar` figuran como número solo para que el coordinador (POS y consola) y el
 * conector de NovuChat compilen sin cambios en este PR; en un tenant que no declara esos mercados NO existen. Leer siempre por
 * `claveDePrecio(id)`. Los PR B3, B4 y D migran a esos consumidores y se retira la intersección.
 */
export type PreciosCentavos = Readonly<Record<string, number>> & { readonly bo: number; readonly ar: number };

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

/**
 * Precios guardados.
 * - Con la configuración del tenant: un entero no negativo por CADA mercado declarado y solo esos se entregan.
 *   Un producto sin la clave de un mercado declarado es corrupto (estricto a propósito): agregar un mercado a un tenant que ya
 *   tiene productos exige completar antes esos precios. Decisión abierta: ver si debe tolerarse «sin precio» (0) en ese caso.
 * - Sin ella (lectores que aún no la reciben: caja, consola, asistente): se comporta EXACTAMENTE como antes de los mercados por
 *   tenant, exige `bo` y `ar` enteros y entrega solo esos dos. Un tenant sin esos mercados FALLA CERRADO (`ProductoCorrupto`) en esos
 *   lectores hasta que migren (B3, B4, D): nunca devuelve `undefined` ni calcula mal en silencio.
 */
function preciosDe(productoId: string, p: Datos, comercial: ConfiguracionComercial | undefined): PreciosCentavos {
  const salida: Record<string, number> = {};
  const claves = comercial !== undefined ? comercial.mercados.map((m) => claveDePrecio(m.id)) : ['bo', 'ar'];
  for (const k of claves) {
    const v = p[k];
    if (!entero(v)) throw new ProductoCorrupto(productoId, 'precioUSD');
    salida[k] = v;
  }
  return salida as unknown as PreciosCentavos;
}

/** Valida el documento de producto; lo que no cumple se rechaza, nunca se corrige. */
export function leerDocumentoProducto(productoId: string, d: Datos, comercial?: ConfiguracionComercial): ProductoLeido {
  if (typeof d['nombre'] !== 'string' || d['nombre'] === '') throw new ProductoCorrupto(productoId, 'nombre');
  if (typeof d['activo'] !== 'boolean') throw new ProductoCorrupto(productoId, 'activo');
  if (typeof d['conSerie'] !== 'boolean') throw new ProductoCorrupto(productoId, 'conSerie');
  const p = d['precioUSD'] as Datos | undefined;
  if (typeof p !== 'object' || p === null) throw new ProductoCorrupto(productoId, 'precioUSD');
  const precios = preciosDe(productoId, p, comercial);
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
    precioCentavos: precios,
    ...(s !== undefined ? { stockTotal: s as number } : {}),
    version: entero(d['version']) ? d['version'] : 0,
  };
}

/** Lee un producto dentro de la transacción del llamador. `undefined` si no existe. */
export async function leerProducto(
  tx: Pick<TransaccionMin, 'get'>,
  tenantId: string,
  productoId: string,
  comercial?: ConfiguracionComercial,
): Promise<ProductoLeido | undefined> {
  const d = await tx.get(ruta(tenantId, 'productos', productoId));
  const datos = d.data();
  return d.existe && datos !== undefined ? leerDocumentoProducto(productoId, datos, comercial) : undefined;
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
