import type { LimiteColeccion } from '../registro/tipos.js';
import type { Resultado } from '../contratos/claim.js';
import type { ConfiguracionComercial } from '../tenant/mercados.js';

/**
 * Identificador de plan. `base` admite un mercado y una moneda; `multimercado` admite varios
 * (el tenant de tres monedas). `pruebas` es `base` con más usuarios, para ensayar en staging; solo se
 * asigna en ese ambiente (lo garantiza el script de asignación y el coordinador, no este tipo).
 */
export type PlanId = 'base' | 'multimercado' | 'pruebas';

/**
 * Claves con tope en el plan. `almacenes` aún no figura en `LimiteColeccion`
 * (tipo del registro, fuera de esta carpeta); cuando se amplíe, basta con
 * reemplazar esta unión por `LimiteColeccion`.
 */
export type ClaveLimite = LimiteColeccion | 'almacenes';

/** Topes de configuración comercial: cuántos mercados y cuántas monedas de caja declara el tenant. */
export type ClaveComercial = 'mercados' | 'monedas';

/** Tope de contenido propio del sitio: fotos subidas para la portada que no son de ningún producto. */
export type ClaveContenido = 'fotosPortada';

export type TopesPlan = { readonly [clave in ClaveLimite | ClaveComercial | ClaveContenido]: number };

/**
 * Topes por plan: lo contratado en la propuesta (200 productos, 3 usuarios,
 * 3 almacenes y 1 caja ACTIVA por turno; `cajas` cuenta cajas abiertas), más
 * un mercado y una moneda en el plan base. `multimercado` repite los topes de
 * uso y admite hasta 5 mercados y 5 monedas. `fotosPortada` (8 en todos) es el cupo de fotos subidas al carrusel de portada.
 */
export const PLANES: { readonly [plan in PlanId]: TopesPlan } = {
  base: { productos: 200, usuarios: 3, cajas: 1, almacenes: 3, mercados: 1, monedas: 1, fotosPortada: 8 },
  multimercado: { productos: 200, usuarios: 3, cajas: 1, almacenes: 3, mercados: 5, monedas: 5, fotosPortada: 8 },
  pruebas: { productos: 200, usuarios: 10, cajas: 1, almacenes: 3, mercados: 1, monedas: 1, fotosPortada: 8 },
};

/*
 * Importante: el documento de tenant en forma LEGADO (sin `comercial`, con `zonaHoraria` y `monedas`) NO pasa por
 * `validarComercialContraPlan`: se acepta tal cual en cualquier plan hasta que el PR E lo migre a `comercial` con el plan
 * `multimercado`. Desde que lleva `comercial`, `validarTenant` mide la configuración contra los topes del plan.
 */
export const esPlanId = (x: unknown): x is PlanId => typeof x === 'string' && Object.hasOwn(PLANES, x);

/** Valida la configuración comercial contra los topes del plan; el error dice qué tope se superó. */
export function validarComercialContraPlan(plan: PlanId, c: ConfiguracionComercial): Resultado<ConfiguracionComercial> {
  const tope = PLANES[plan];
  if (c.mercados.length > tope.mercados) {
    return { ok: false, error: `El plan ${plan} admite ${tope.mercados} mercado(s) y el tenant declara ${c.mercados.length}` };
  }
  if (c.monedas.length > tope.monedas) {
    return { ok: false, error: `El plan ${plan} admite ${tope.monedas} moneda(s) de caja y el tenant declara ${c.monedas.length}` };
  }
  return { ok: true, valor: c };
}
