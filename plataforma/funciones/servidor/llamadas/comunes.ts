// Esquemas y utilidades compartidas por las tablas de acciones.
import { z } from 'zod';
import { HttpsError } from 'firebase-functions/v2/https';

export const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'debe ser un UUID');
/** Identificador de operación o de documento: letras, números, punto, guion y guion bajo. */
export const ID = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/, 'identificador inválido');
export const ID_PRODUCTO = z.string().regex(/^[a-z0-9][a-z0-9-]{1,59}$/, 'productoId inválido');
export const UBICACION = z.enum(['tienda', 'deposito-1', 'deposito-2']);
export const TEXTO = (max = 500) => z.string().min(1).max(max);
export const MS = z.number().int().nonnegative().max(8_640_000_000_000_000);
/** Objeto libre cuyo contenido valida el módulo dueño con su propio esquema estricto. */
export const OBJETO = z.record(z.string().max(80), z.unknown());
export const VACIO = z.object({}).strict();
export const LIMITE = z.number().int().min(1).max(200);

export const objeto = <T extends z.ZodRawShape>(forma: T) => z.object(forma).strict();

/** Rango de fechas (milisegundos) con tope de 366 días, para listados y exportaciones. */
export function validarRango(desde: number | undefined, hasta: number | undefined): void {
  if (desde !== undefined && hasta !== undefined && (hasta < desde || hasta - desde > 366 * 86_400_000)) {
    throw new HttpsError('invalid-argument', 'El rango de fechas debe ser de hasta 366 días.');
  }
}

/** Series de texto de líneas de inventario: la lista la valida Inventarios; aquí solo se acota el tamaño. */
export const LISTA = (max = 50) => z.array(OBJETO).min(1).max(max);
