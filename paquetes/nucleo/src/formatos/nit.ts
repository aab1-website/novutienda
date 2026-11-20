/** Largo permitido del NIT al guardar, contando los guiones. */
export const NIT_LARGO_MINIMO = 5;
export const NIT_LARGO_MAXIMO = 20;

export const MENSAJE_NIT = 'El NIT lleva solo números, con guiones opcionales, de 5 a 20 caracteres';

/**
 * NIT válido para GUARDAR: dígitos separados por guiones simples (sin guion al principio,
 * al final ni repetido), de 5 a 20 caracteres. La lectura de lo ya guardado NO usa esta regla.
 */
export function esNitValido(x: unknown): boolean {
  return typeof x === 'string' && x.length >= NIT_LARGO_MINIMO && x.length <= NIT_LARGO_MAXIMO && /^\d+(-\d+)*$/.test(x);
}
