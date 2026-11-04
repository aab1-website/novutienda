import type { LimiteColeccion } from '../registro/tipos.js';

/** Identificador de plan. La propuesta firmada define un único plan. */
export type PlanId = 'base';

export type TopesPlan = { readonly [clave in LimiteColeccion]: number };

/** Topes por plan: lo contratado en la propuesta (200 productos, 3 usuarios, 1 caja). */
export const PLANES: { readonly [plan in PlanId]: TopesPlan } = {
  base: { productos: 200, usuarios: 3, cajas: 1 },
};

export const esPlanId = (x: unknown): x is PlanId => typeof x === 'string' && Object.hasOwn(PLANES, x);
