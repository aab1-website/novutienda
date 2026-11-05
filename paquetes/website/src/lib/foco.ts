/** Foco atrapado en ventanas modales: a qué elemento pasa el foco con Tab / Mayús+Tab. */

/** Índice al que debe ir el foco dentro de `total` elementos enfocables; -1 si no hay ninguno. */
export function indiceDeFoco(total: number, actual: number, retroceso: boolean): number {
  if (total <= 0) return -1;
  if (actual < 0 || actual >= total) return retroceso ? total - 1 : 0;
  if (retroceso) return actual === 0 ? total - 1 : actual - 1;
  return actual === total - 1 ? 0 : actual + 1;
}

export const SELECTOR_ENFOCABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])';
