import type { LimiteColeccion } from '../registro/tipos.js';

/** Identificador de plan. La propuesta firmada define un único plan. */
export type PlanId = 'base';

/**
 * Claves con tope en el plan. `almacenes` aún no figura en `LimiteColeccion`
 * (tipo del registro, fuera de esta carpeta); cuando se amplíe, basta con
 * reemplazar esta unión por `LimiteColeccion`.
 */
export type ClaveLimite = LimiteColeccion | 'almacenes';

export type TopesPlan = { readonly [clave in ClaveLimite]: number };

/**
 * Topes por plan: lo contratado en la propuesta (200 productos, 3 usuarios,
 * 3 almacenes y 1 caja ACTIVA por turno; `cajas` cuenta cajas abiertas).
 */
export const PLANES: { readonly [plan in PlanId]: TopesPlan } = {
  base: { productos: 200, usuarios: 3, cajas: 1, almacenes: 3 },
};

export const esPlanId = (x: unknown): x is PlanId => typeof x === 'string' && Object.hasOwn(PLANES, x);
