/**
 * Escritor mínimo de archivos .xlsx, sin dependencias: un ZIP en modo «store» (método 0, sin compresión) con CRC32, un libro y
 * una hoja por pestaña con todas las celdas como texto en línea (`inlineStr`). Basta para que Excel y las demás planillas lo abran,
 * y para que el lector del servidor (`lector-hojas.ts`) lo lea de vuelta. No evalúa nada: cada celda es texto.
 */

export type CeldaXlsx = string | number | boolean | null | undefined;
export interface HojaXlsx {
  readonly nombre: string;
  readonly filas: readonly (readonly CeldaXlsx[])[];
  /** Anchos de columna en caracteres (opcional). */
  readonly anchos?: readonly number[];
}

/** Igual que la exportación del servidor: un apóstrofe delante si el texto empieza con = + - @, TAB o CR (la importación lo quita). */
export const neutralizarCeldaXlsx = (v: string): string => (/^'*[=+\-@\t\r]/.test(v) ? `'${v}` : v);

/** Caracteres que XML 1.0 no admite (controles salvo TAB, LF y CR; y U+FFFE, U+FFFF). */
// eslint-disable-next-line no-control-regex
const NO_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

/** Se quitan los caracteres no admitidos ANTES de neutralizar: así una celda que empieza con uno de ellos y luego `=` también se neutraliza. */
const TEXTO_CELDA = (v: CeldaXlsx): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'sí' : 'no';
  return neutralizarCeldaXlsx(String(v).replace(NO_XML, ''));
};

/** Escapa XML. El CR se escribe como referencia numérica: un CR literal se normalizaría a LF al leer el archivo. */
const xml = (t: string): string =>
  t.replace(NO_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r/g, '&#13;');

const letraColumna = (i: number): string => {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

function xmlHoja(h: HojaXlsx): string {
  const cols = h.anchos === undefined ? '' : `<cols>${h.anchos.map((a, i) => `<col min="${String(i + 1)}" max="${String(i + 1)}" width="${String(a)}" customWidth="1"/>`).join('')}</cols>`;
  const filas = h.filas.map((f, r) => {
    const celdas = f.map((v, c) => {
      // Un número finito va como celda numérica (Excel puede sumarlo); un NaN o un infinito no sale como número: la celda queda vacía.
      if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${letraColumna(c)}${String(r + 1)}" t="n"><v>${String(v)}</v></c>` : '';
      const t = TEXTO_CELDA(v);
      if (t === '') return '';
      return `<c r="${letraColumna(c)}${String(r + 1)}" t="inlineStr"><is><t xml:space="preserve">${xml(t)}</t></is></c>`;
    }).join('');
    return `<row r="${String(r + 1)}">${celdas}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${filas}</sheetData></worksheet>`;
}

const TABLA_CRC: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(datos: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of datos) c = (TABLA_CRC[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface EntradaZip { readonly nombre: string; readonly datos: Uint8Array }

/** ZIP en modo store. Fecha fija (1980-01-01) para que el resultado sea determinista. */
function zip(entradas: readonly EntradaZip[]): Uint8Array {
  const enc = new TextEncoder();
  const locales: Uint8Array[] = [];
  const centrales: Uint8Array[] = [];
  let desplazamiento = 0;
  for (const e of entradas) {
    const nombre = enc.encode(e.nombre);
    const crc = crc32(e.datos);
    const local = new Uint8Array(30 + nombre.length + e.datos.length);
    const v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x0800, true); // nombres en UTF-8
    v.setUint16(8, 0, true); // método 0: store
    v.setUint16(10, 0, true);
    v.setUint16(12, 0x0021, true); // 1980-01-01
    v.setUint32(14, crc, true);
    v.setUint32(18, e.datos.length, true);
    v.setUint32(22, e.datos.length, true);
    v.setUint16(26, nombre.length, true);
    v.setUint16(28, 0, true);
    local.set(nombre, 30);
    local.set(e.datos, 30 + nombre.length);
    const central = new Uint8Array(46 + nombre.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, 0, true);
    c.setUint16(14, 0x0021, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, e.datos.length, true);
    c.setUint32(24, e.datos.length, true);
    c.setUint16(28, nombre.length, true);
    c.setUint32(42, desplazamiento, true);
    central.set(nombre, 46);
    locales.push(local);
    centrales.push(central);
    desplazamiento += local.length;
  }
  const tamCentral = centrales.reduce((s, x) => s + x.length, 0);
  const fin = new Uint8Array(22);
  const f = new DataView(fin.buffer);
  f.setUint32(0, 0x06054b50, true);
  f.setUint16(8, entradas.length, true);
  f.setUint16(10, entradas.length, true);
  f.setUint32(12, tamCentral, true);
  f.setUint32(16, desplazamiento, true);
  const salida = new Uint8Array(desplazamiento + tamCentral + 22);
  let p = 0;
  for (const parte of [...locales, ...centrales, fin]) { salida.set(parte, p); p += parte.length; }
  return salida;
}

/** Nombre de pestaña válido para Excel: sin `: \ / ? * [ ]`, hasta 31 caracteres y no vacío. */
const nombreHoja = (n: string): string => n.replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || 'Hoja';

/** Arma el libro .xlsx. La primera hoja es la que lee la importación. */
export function escribirXlsx(hojas: readonly HojaXlsx[]): Uint8Array {
  if (hojas.length === 0) throw new Error('El libro necesita al menos una hoja.');
  const enc = new TextEncoder();
  const idx = hojas.map((_, i) => String(i + 1));
  const entradas: EntradaZip[] = [
    { nombre: '[Content_Types].xml', datos: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${idx.map((i) => `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`) },
    { nombre: '_rels/.rels', datos: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
    { nombre: 'xl/workbook.xml', datos: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${hojas.map((h, i) => `<sheet name="${xml(nombreHoja(h.nombre))}" sheetId="${idx[i] as string}" r:id="rId${idx[i] as string}"/>`).join('')}</sheets></workbook>`) },
    { nombre: 'xl/_rels/workbook.xml.rels', datos: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${idx.map((i) => `<Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}.xml"/>`).join('')}<Relationship Id="rIdEstilos" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { nombre: 'xl/styles.xml', datos: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>') },
    ...hojas.map((h, i): EntradaZip => ({ nombre: `xl/worksheets/sheet${idx[i] as string}.xml`, datos: enc.encode(xmlHoja(h)) })),
  ];
  return zip(entradas);
}

/** Lector acotado del CSV propio de la exportación (RFC 4180: comillas dobles, comas y saltos dentro de comillas). */
export function leerCsvPropio(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = '';
  let entre = false;
  let hay = false;
  const t = texto.startsWith('﻿') ? texto.slice(1) : texto;
  for (let i = 0; i < t.length; i++) {
    const ch = t.charAt(i);
    if (entre) {
      if (ch === '"') { if (t.charAt(i + 1) === '"') { celda += '"'; i++; } else entre = false; } else celda += ch;
    } else if (ch === '"') { entre = true; hay = true; }
    else if (ch === ',') { fila.push(celda); celda = ''; hay = true; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t.charAt(i + 1) === '\n') i++;
      if (hay || celda !== '') { fila.push(celda); filas.push(fila); }
      fila = []; celda = ''; hay = false;
    } else { celda += ch; hay = true; }
  }
  if (hay || celda !== '') { fila.push(celda); filas.push(fila); }
  return filas;
}

/** Quita el apóstrofe de neutralización que puso la exportación, para que el escritor lo ponga una sola vez. */
const sinNeutralizar = (v: string): string => (/^'+[=+\-@\t\r]/.test(v) ? v.slice(1) : v);

const COLUMNAS_SI_NO = new Set(['conSerie', 'activo', 'publicado']);

/** Lleva el CSV de la exportación a filas de hoja: `true/false` pasa a «sí/no» (solo en el Excel; el CSV no cambia). */
export function filasDeExportacion(csv: string): string[][] {
  const [cab = [], ...cuerpo] = leerCsvPropio(csv);
  const si = cab.map((c) => COLUMNAS_SI_NO.has(c));
  return [cab, ...cuerpo.map((f) => f.map((v, i) => (si[i] === true ? (v === 'true' ? 'sí' : v === 'false' ? 'no' : v) : sinNeutralizar(v))))];
}

export const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Descarga bytes como archivo desde el navegador. */
export function descargarBytes(nombre: string, bytes: Uint8Array, tipo = TIPO_XLSX): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
