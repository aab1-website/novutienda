/**
 * Reglas de redondeo del precio: tipos y validación (sin dependencias, para que las use la configuración del tenant).
 * Regla única para todos los tenants (decisión D7): 0, 1 o 2 decimales, o un múltiplo de al menos 0,01 y exacto en
 * centavos. No existe «sin redondear» ni más de 2 decimales: el dinero se guarda en centavos y lo mostrado es lo cobrado.
 */

export type ModoRedondeo = 'cercano' | 'arriba' | 'abajo';

export type ReglaRedondeo =
  | { readonly tipo: 'decimales'; readonly decimales: number; readonly modo: ModoRedondeo }
  /** Al múltiplo más cercano/superior/inferior de `multiplo` (por ejemplo, de 5 en 5); mínimo 0,01 y exacto en centavos. */
  | { readonly tipo: 'multiplo'; readonly multiplo: number; readonly modo: ModoRedondeo };

const MODOS: readonly string[] = ['cercano', 'arriba', 'abajo'];
const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Motivo por el que la regla no es admitida, o `null` si lo es. Nunca «corrige» una regla: la rechaza. */
export function motivoReglaRedondeoInvalida(r: unknown): string | null {
  if (!esObjeto(r)) return 'falta la regla de redondeo';
  if (r['tipo'] === 'decimales') {
    const d = r['decimales'];
    if (!(typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 2)) return 'los decimales deben ser 0, 1 o 2: no se admite más de 2 decimales (el dinero se guarda en centavos)';
  } else if (r['tipo'] === 'multiplo') {
    const m = r['multiplo'];
    if (typeof m !== 'number' || !Number.isFinite(m)) return 'el múltiplo debe ser un número';
    if (m < 0.01 || Math.round(m * 100) / 100 !== m) return 'el múltiplo debe ser de al menos 0,01 y de centavos exactos';
  } else {
    return 'el tipo de redondeo debe ser decimales o multiplo («sin redondear» ya no se admite)';
  }
  return typeof r['modo'] === 'string' && MODOS.includes(r['modo']) ? null : 'el modo debe ser cercano, arriba o abajo';
}

/** ¿La regla de redondeo es admitida? */
export function esReglaRedondeoValida(r: unknown): r is ReglaRedondeo {
  return motivoReglaRedondeoInvalida(r) === null;
}
