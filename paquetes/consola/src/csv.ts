/** Serialización CSV para la exportación del catálogo. */

const INICIOS_DE_FORMULA = new Set(['=', '+', '-', '@', '\t', '\r']);

/** Neutraliza una celda que una hoja de cálculo ejecutaría como fórmula (empieza con = + - @): antepone «'». */
export function neutralizarCelda(valor: string): string {
  return valor !== '' && INICIOS_DE_FORMULA.has(valor[0] as string) ? `'${valor}` : valor;
}

const escapar = (v: string, delimitador: string): string =>
  /["\r\n]/.test(v) || v.includes(delimitador) ? `"${v.replaceAll('"', '""')}"` : v;

/** Serializa filas a CSV neutralizando cada celda de texto. */
export function aCsv(filas: readonly (readonly string[])[], delimitador: ',' | ';' = ','): string {
  return filas.map((f) => f.map((c) => escapar(neutralizarCelda(c), delimitador)).join(delimitador)).join('\r\n') + '\r\n';
}
