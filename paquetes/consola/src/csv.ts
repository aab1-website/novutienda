/** CSV mínimo (RFC 4180): comillas dobles, saltos de línea dentro de comillas, CRLF o LF. */

export const MAX_FILAS_CSV = 5000;
export const MAX_BYTES_ARCHIVO = 2 * 1024 * 1024;

export class ErrorCsv extends Error {}

/** Elige coma o punto y coma según cuál aparezca más en la primera línea (las hojas en español usan «;»). */
export function detectarDelimitador(texto: string): ',' | ';' {
  const primera = texto.split(/\r\n|\n|\r/, 1)[0] ?? '';
  const comas = primera.split(',').length;
  const puntos = primera.split(';').length;
  return puntos > comas ? ';' : ',';
}

export function parsearCsv(texto: string, delimitador: ',' | ';' = detectarDelimitador(texto)): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = '';
  let entreComillas = false;
  let hayContenido = false;
  const cerrarFila = (): void => {
    fila.push(celda);
    celda = '';
    if (hayContenido || fila.length > 1) filas.push(fila);
    if (filas.length > MAX_FILAS_CSV) throw new ErrorCsv(`El archivo supera ${String(MAX_FILAS_CSV)} filas`);
    fila = [];
    hayContenido = false;
  };
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i] as string;
    if (entreComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          celda += '"';
          i += 1;
        } else entreComillas = false;
      } else celda += c;
    } else if (c === '"' && celda === '') {
      entreComillas = true;
      hayContenido = true;
    } else if (c === delimitador) {
      fila.push(celda);
      celda = '';
      hayContenido = true;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i += 1;
      cerrarFila();
    } else {
      celda += c;
      hayContenido = true;
    }
  }
  if (entreComillas) throw new ErrorCsv('Comillas sin cerrar en el archivo');
  if (celda !== '' || fila.length > 0 || hayContenido) cerrarFila();
  return filas;
}

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

/** Decodifica UTF-8 de forma estricta (sin depender de TextDecoder); undefined si la secuencia es inválida. */
export function decodificarUtf8(b: Uint8Array): string | undefined {
  let s = '';
  let i = 0;
  while (i < b.length) {
    const x = b[i] as number;
    let n = 0;
    let cp: number;
    let min = 0;
    if (x < 0x80) {
      cp = x;
    } else if (x >= 0xc2 && x <= 0xdf) {
      n = 1;
      cp = x & 0x1f;
      min = 0x80;
    } else if (x >= 0xe0 && x <= 0xef) {
      n = 2;
      cp = x & 0x0f;
      min = 0x800;
    } else if (x >= 0xf0 && x <= 0xf4) {
      n = 3;
      cp = x & 0x07;
      min = 0x10000;
    } else return undefined;
    for (let k = 1; k <= n; k += 1) {
      const y = b[i + k];
      if (y === undefined || (y & 0xc0) !== 0x80) return undefined;
      cp = (cp << 6) | (y & 0x3f);
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return undefined;
    s += String.fromCodePoint(cp);
    i += n + 1;
  }
  return s;
}
