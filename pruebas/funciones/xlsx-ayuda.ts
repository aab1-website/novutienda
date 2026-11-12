// Constructor mínimo de .xlsx para pruebas (ZIP con `node:zlib`, sin librerías): arma archivos reales pequeños y también
// archivos hostiles (bomba de descompresión, DTD, demasiadas entradas) para el lector de hojas.
import { crc32, deflateRawSync } from 'node:zlib';

export interface EntradaZip { readonly nombre: string; readonly datos: Buffer; readonly metodo?: 0 | 8 }

export function zip(entradas: readonly EntradaZip[]): Buffer {
  const locales: Buffer[] = [];
  const centrales: Buffer[] = [];
  let pos = 0;
  for (const e of entradas) {
    const metodo = e.metodo ?? 8;
    const comp = metodo === 8 ? deflateRawSync(e.datos) : e.datos;
    const nombre = Buffer.from(e.nombre);
    const crc = crc32(e.datos);
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(metodo, 8);
    loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(comp.length, 18); loc.writeUInt32LE(e.datos.length, 22); loc.writeUInt16LE(nombre.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(metodo, 10);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(e.datos.length, 24); cen.writeUInt16LE(nombre.length, 28); cen.writeUInt32LE(pos, 42);
    locales.push(loc, nombre, comp);
    centrales.push(cen, nombre);
    pos += 30 + nombre.length + comp.length;
  }
  const dir = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(entradas.length, 8); fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(dir.length, 12); fin.writeUInt32LE(pos, 16);
  return Buffer.concat([...locales, dir, fin]);
}

const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const letra = (i: number): string => String.fromCharCode(65 + i);

/** Libro de una hoja: texto por cadenas compartidas, números como tal y, si la celda empieza con `=`, una fórmula con valor guardado. */
export function xlsx(filas: readonly (readonly (string | number | null)[])[], extra: readonly EntradaZip[] = [], hoja?: string): Buffer {
  const compartidas: string[] = [];
  const cuerpo = filas.map((fila, r) => {
    const celdas = fila.map((v, c) => {
      const ref = `${letra(c)}${String(r + 1)}`;
      if (v === null) return '';
      if (typeof v === 'number') return `<c r="${ref}"><v>${String(v)}</v></c>`;
      if (v.startsWith('=')) return `<c r="${ref}" t="str"><f>${esc(v.slice(1))}</f><v>valor-guardado</v></c>`;
      compartidas.push(v);
      return `<c r="${ref}" t="s"><v>${String(compartidas.length - 1)}</v></c>`;
    });
    return `<row r="${String(r + 1)}">${celdas.join('')}</row>`;
  });
  const t = (s: string): Buffer => Buffer.from(s);
  return zip([
    { nombre: '[Content_Types].xml', datos: t('<Types/>') },
    { nombre: 'xl/workbook.xml', datos: t('<workbook xmlns:r="r"><sheets><sheet name="Hoja1" sheetId="1" r:id="rId1"/></sheets></workbook>') },
    { nombre: 'xl/_rels/workbook.xml.rels', datos: t('<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>') },
    { nombre: 'xl/sharedStrings.xml', datos: t(`<sst>${compartidas.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`) },
    { nombre: 'xl/worksheets/sheet1.xml', datos: t(hoja ?? `<worksheet><sheetData>${cuerpo.join('')}</sheetData></worksheet>`) },
    ...extra,
  ]);
}
