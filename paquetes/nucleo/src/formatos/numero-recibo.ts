/** Número de recibo como se imprime: serie, guion y seis dígitos (A-000006). */
export const numeroDeRecibo = (serie: string, n: number): string => `${serie}-${String(n).padStart(6, '0')}`;

/** Formas con que una persona busca un recibo: «A-000006», «A6», «A-6» y «6». */
export function aliasRecibo(serie: string, n: number): string[] {
  return [numeroDeRecibo(serie, n), `${serie}${n}`, `${serie}-${n}`, String(n)];
}

/** Interpreta «A6», «a-6», «A-000006» o «6»; la serie sale en mayúsculas. `null` si no es un número de recibo. */
export function interpretarNumeroRecibo(texto: string): { serie?: string; numero: number } | null {
  const m = /^(?:([A-Za-z]+)\s*-?\s*)?(\d{1,9})$/.exec(texto.trim());
  if (!m) return null;
  const numero = Number(m[2]);
  if (!Number.isSafeInteger(numero) || numero < 1) return null;
  return m[1] ? { serie: m[1].toUpperCase(), numero } : { numero };
}
