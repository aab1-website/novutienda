/** Reglas de redondeo del precio: tipos y validación (sin dependencias, para que las use la configuración del tenant). */

export type ModoRedondeo = 'cercano' | 'arriba' | 'abajo';

export type ReglaRedondeo =
  | { readonly tipo: 'ninguno' }
  | { readonly tipo: 'decimales'; readonly decimales: number; readonly modo: ModoRedondeo }
  /** Al múltiplo más cercano/superior/inferior de `multiplo` (por ejemplo, de 5 en 5). */
  | { readonly tipo: 'multiplo'; readonly multiplo: number; readonly modo: ModoRedondeo };

/** ¿La regla de redondeo está bien formada? */
export function esReglaRedondeoValida(r: ReglaRedondeo | undefined): boolean {
  if (!r) return false;
  if (r.tipo === 'decimales') return Number.isInteger(r.decimales) && r.decimales >= 0 && r.decimales <= 6 && ['cercano', 'arriba', 'abajo'].includes(r.modo);
  if (r.tipo === 'multiplo') return Number.isFinite(r.multiplo) && r.multiplo > 0 && ['cercano', 'arriba', 'abajo'].includes(r.modo);
  return r.tipo === 'ninguno';
}
