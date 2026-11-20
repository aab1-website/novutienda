/** Número de recibo como se imprime: serie, guion y seis dígitos (A-000004). */
export const numeroDeRecibo = (serie: string, receiptNo: number): string => `${serie}-${String(receiptNo).padStart(6, '0')}`;

/**
 * Formas con que una persona busca un recibo: «A-000004», «A4», «A-4» y «4». La búsqueda de `Tabla` es por subcadena
 * sin mayúsculas, así que «4» también trae 14 y 40; es lo aceptado (decisión C1).
 */
export function aliasRecibo(serie: string, receiptNo: number): string[] {
  return [numeroDeRecibo(serie, receiptNo), `${serie}${receiptNo}`, `${serie}-${receiptNo}`, String(receiptNo)];
}
