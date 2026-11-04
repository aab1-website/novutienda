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
