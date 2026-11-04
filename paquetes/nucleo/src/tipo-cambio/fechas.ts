import { ZONA_DE, type Mercado } from './tipos.js';

/** La fecha civil «aaaa-mm-dd» de un instante en la zona horaria del mercado. */
export function hoyEn(mercado: Mercado, ahoraMs: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_DE[mercado], year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ahoraMs));
}

/** Días enteros de `a` a `b` (positivo si `b` es posterior). Ambas «aaaa-mm-dd». */
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Calendario de feriados inyectable: ¿esa fecha «aaaa-mm-dd» es feriado en el mercado? No hay lista por defecto (no se inventan feriados). */
export type EsFeriado = (fecha: string, mercado: Mercado) => boolean;

/** Tope de días recorridos al contar hábiles; más allá, cualquier límite razonable ya está excedido. */
const TOPE_RECORRIDO = 400;

const DIA_MS = 86_400_000;

/**
 * Días hábiles (lunes a viernes que no son feriados) en el intervalo (`desde`, `hasta`]:
 * el día de `desde` no cuenta, el de `hasta` sí. 0 si `hasta` no es posterior.
 * Sin calendario, solo se descuentan sábados y domingos.
 */
export function diasHabilesEntre(desde: string, hasta: string, mercado: Mercado, esFeriado?: EsFeriado): number {
  const total = diasEntre(desde, hasta);
  if (total <= 0) return 0;
  const base = Date.parse(`${desde}T00:00:00Z`);
  let habiles = 0;
  for (let i = 1; i <= Math.min(total, TOPE_RECORRIDO); i++) {
    const d = new Date(base + i * DIA_MS);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (esFeriado?.(d.toISOString().slice(0, 10), mercado)) continue;
    habiles++;
  }
  return total > TOPE_RECORRIDO ? habiles + (total - TOPE_RECORRIDO) : habiles;
}
