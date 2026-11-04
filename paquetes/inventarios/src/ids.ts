import { esTenantIdValido } from '@plataforma/nucleo';
import { EntradaInvalida } from './errores.js';

/** Validación estricta: lo que no cumple se rechaza, nunca se corrige (sin trim, sin minúsculas). */

export const UBICACIONES = ['tienda', 'deposito-1', 'deposito-2'] as const;
export type UbicacionId = (typeof UBICACIONES)[number];

export const MAX_LINEAS = 50;
export const MAX_CANTIDAD = 1_000_000;

const PRODUCTO = /^[a-z0-9][a-z0-9-]{1,59}$/;
/** Sin «__»: el separador de los ids compuestos no puede aparecer dentro de una parte. */
const SEGMENTO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SERIE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SKU = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

export const esProductoId = (x: unknown): x is string => typeof x === 'string' && PRODUCTO.test(x);
export const esUbicacionId = (x: unknown): x is UbicacionId => typeof x === 'string' && (UBICACIONES as readonly string[]).includes(x);
export const esSerie = (x: unknown): x is string => typeof x === 'string' && SERIE.test(x) && !x.includes('__');
export const esSku = (x: unknown): x is string => typeof x === 'string' && SKU.test(x);
/** Identificador libre de operación, merma o conteo. */
export const esIdSegmento = (x: unknown): x is string => typeof x === 'string' && SEGMENTO.test(x) && !x.includes('__');
export const esCantidad = (x: unknown): x is number =>
  typeof x === 'number' && Number.isSafeInteger(x) && x >= 1 && x <= MAX_CANTIDAD;

export function exigirTenant(x: unknown): string {
  if (!esTenantIdValido(x)) throw new EntradaInvalida('tenantId inválido');
  return x;
}
export function exigirProducto(x: unknown): string {
  if (!esProductoId(x)) throw new EntradaInvalida(`productoId inválido: ${String(x)}`);
  return x;
}
export function exigirUbicacion(x: unknown): UbicacionId {
  if (!esUbicacionId(x)) throw new EntradaInvalida(`ubicación inválida: ${String(x)}`);
  return x;
}
export function exigirSegmento(x: unknown, nombre: string): string {
  if (!esIdSegmento(x)) throw new EntradaInvalida(`${nombre} inválido`);
  return x;
}
export function exigirCantidad(x: unknown): number {
  if (!esCantidad(x)) throw new EntradaInvalida(`cantidad inválida: ${String(x)}`);
  return x;
}
export function exigirSeries(x: unknown): string[] {
  if (!Array.isArray(x)) throw new EntradaInvalida('series debe ser una lista');
  for (const s of x) if (!esSerie(s)) throw new EntradaInvalida(`serie inválida: ${String(s)}`);
  if (new Set(x).size !== x.length) throw new EntradaInvalida('series repetidas');
  return x as string[];
}
export function exigirTexto(x: unknown, nombre: string, max = 500): string {
  if (typeof x !== 'string' || x.trim() === '' || x.length > max) throw new EntradaInvalida(`${nombre} requerido`);
  return x;
}

export const idExistencia = (p: string, u: string): string => `${p}__${u}`;
export const idUnidad = (p: string, serie: string): string => `${p}__${serie}`;
export const idMovimiento = (op: string, p: string, u: string): string => `${op}__${p}__${u}`;

export const ruta = (tenantId: string, coleccion: string, id: string): string => `tenants/${tenantId}/${coleccion}/${id}`;
