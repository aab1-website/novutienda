// Adaptador de `LectorHojas` (puerto de Inventarios) para archivos .xlsx, sin dependencias nuevas: `node:zlib` y un
// lector mínimo de ZIP y de XML. El archivo NO es confiable, así que cada paso tiene tope:
//  - ZIP: firma, directorio central acotado (máx. 200 entradas), sin cifrado ni ZIP64, solo métodos 0 y 8, offsets validados;
//  - descompresión: `maxOutputLength` por entrada y total (bomba de descompresión), nunca por el tamaño que declara el archivo;
//  - XML: se rechaza cualquier DOCTYPE/ENTITY (sin entidades externas ni expansión); solo se resuelven las cinco
//    entidades predefinidas y las referencias numéricas;
//  - celdas: se lee el valor guardado (`<v>`/`<is>`), nunca se evalúa una fórmula; topes de filas y columnas.
import { inflateRawSync } from 'node:zlib';
import type { LectorHojas } from '@novutienda/inventarios';

const MAX_ENTRADAS = 200;
const MAX_BYTES_ENTRADA = 16 * 1024 * 1024;
const MAX_BYTES_TOTAL = 32 * 1024 * 1024;
const MAX_FILA_INDICE = 5_000;
const MAX_COLUMNA_INDICE = 100;
const MAX_CELDAS = 200_000;

export class XlsxInvalido extends Error {}

interface EntradaZip { readonly metodo: number; readonly comprimido: number; readonly desplazamiento: number }

function indiceZip(b: Buffer): Map<string, EntradaZip> {
  const minimo = Math.max(0, b.length - 22 - 65_535);
  let eocd = -1;
  for (let i = b.length - 22; i >= minimo; i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new XlsxInvalido('sin directorio central');
  const total = b.readUInt16LE(eocd + 10);
  let pos = b.readUInt32LE(eocd + 16);
  if (total > MAX_ENTRADAS || total === 0xffff) throw new XlsxInvalido('demasiadas entradas');
  const salida = new Map<string, EntradaZip>();
  for (let n = 0; n < total; n++) {
    if (pos + 46 > b.length || b.readUInt32LE(pos) !== 0x02014b50) throw new XlsxInvalido('directorio central dañado');
    const flags = b.readUInt16LE(pos + 8);
    const metodo = b.readUInt16LE(pos + 10);
    const comprimido = b.readUInt32LE(pos + 20);
    const largoNombre = b.readUInt16LE(pos + 28);
    const largoExtra = b.readUInt16LE(pos + 30);
    const largoComentario = b.readUInt16LE(pos + 32);
    const desplazamiento = b.readUInt32LE(pos + 42);
    if (pos + 46 + largoNombre > b.length) throw new XlsxInvalido('directorio central dañado');
    if ((flags & 1) !== 0) throw new XlsxInvalido('archivo cifrado');
    if (comprimido === 0xffffffff || desplazamiento === 0xffffffff) throw new XlsxInvalido('ZIP64 no admitido');
    const nombre = b.toString('utf8', pos + 46, pos + 46 + largoNombre);
    salida.set(nombre, { metodo, comprimido, desplazamiento });
    pos += 46 + largoNombre + largoExtra + largoComentario;
  }
  return salida;
}

class Descompresor {
  private total = 0;
  constructor(private readonly b: Buffer, private readonly indice: Map<string, EntradaZip>) {}

  tiene(nombre: string): boolean { return this.indice.has(nombre); }

  leer(nombre: string): string | undefined {
    const e = this.indice.get(nombre);
    if (e === undefined) return undefined;
    const p = e.desplazamiento;
    if (p + 30 > this.b.length || this.b.readUInt32LE(p) !== 0x04034b50) throw new XlsxInvalido('entrada dañada');
    const inicio = p + 30 + this.b.readUInt16LE(p + 26) + this.b.readUInt16LE(p + 28);
    if (inicio + e.comprimido > this.b.length) throw new XlsxInvalido('entrada fuera del archivo');
    const crudo = this.b.subarray(inicio, inicio + e.comprimido);
    const restante = MAX_BYTES_TOTAL - this.total;
    const tope = Math.min(MAX_BYTES_ENTRADA, restante);
    let datos: Buffer;
    if (e.metodo === 0) datos = crudo;
    else if (e.metodo === 8) {
      try { datos = inflateRawSync(crudo, { maxOutputLength: tope }); } catch { throw new XlsxInvalido('descompresión excedida o inválida'); }
    } else throw new XlsxInvalido('método de compresión no admitido');
    if (datos.length > tope) throw new XlsxInvalido('entrada demasiado grande');
    this.total += datos.length;
    return datos.toString('utf8');
  }
}

const ENTIDADES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodificar(t: string): string {
  return t.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-z]{2,4});/g, (m, g: string) => {
    if (g.startsWith('#x')) return puntoCodigo(parseInt(g.slice(2), 16), m);
    if (g.startsWith('#')) return puntoCodigo(parseInt(g.slice(1), 10), m);
    return ENTIDADES[g] ?? m;
  });
}
const puntoCodigo = (n: number, original: string): string => (n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : original);

function exigirXmlSeguro(xml: string): string {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new XlsxInvalido('XML con DTD/entidades no admitido');
  return xml;
}

const atributo = (etiqueta: string, nombre: string): string | undefined => {
  const m = new RegExp(`(?:^|\\s)${nombre}="([^"]*)"`).exec(etiqueta);
  return m === undefined || m === null ? undefined : decodificar(m[1] ?? '');
};

/** Texto de un `<si>`/`<is>`: concatena los `<t>` y descarta la fonética (`<rPh>`). */
function textoDe(fragmento: string): string {
  const sinFonetica = fragmento.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let s = '';
  for (const m of sinFonetica.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) s += decodificar(m[1] ?? '');
  return s;
}

function cadenasCompartidas(xml: string | undefined): string[] {
  if (xml === undefined) return [];
  const salida: string[] = [];
  for (const m of exigirXmlSeguro(xml).matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) {
    salida.push(textoDe(m[1] ?? ''));
    if (salida.length > MAX_CELDAS) throw new XlsxInvalido('demasiadas cadenas');
  }
  return salida;
}

function columnaDe(ref: string): number {
  const m = /^([A-Z]{1,3})/.exec(ref);
  if (m === null) throw new XlsxInvalido('referencia de celda inválida');
  let n = 0;
  for (const ch of m[1] ?? '') n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Ruta de la primera hoja según el orden de `workbook.xml` y sus relaciones (no por el nombre del archivo). */
function rutaPrimeraHoja(z: Descompresor): string {
  const libro = z.leer('xl/workbook.xml');
  const rels = z.leer('xl/_rels/workbook.xml.rels');
  if (libro === undefined || rels === undefined) throw new XlsxInvalido('no es un libro de Excel');
  const hoja = /<sheet\b[^>]*>/.exec(exigirXmlSeguro(libro));
  const rid = hoja === null ? undefined : (atributo(hoja[0], 'r:id') ?? atributo(hoja[0], 'id'));
  if (rid === undefined) throw new XlsxInvalido('el libro no tiene hojas');
  for (const m of exigirXmlSeguro(rels).matchAll(/<Relationship\b[^>]*>/g)) {
    if (atributo(m[0], 'Id') !== rid) continue;
    const destino = atributo(m[0], 'Target');
    if (destino === undefined) break;
    const limpio = destino.startsWith('/') ? destino.slice(1) : `xl/${destino}`;
    if (limpio.includes('..')) throw new XlsxInvalido('ruta de hoja inválida');
    return limpio;
  }
  throw new XlsxInvalido('hoja no encontrada');
}

export function leerPrimeraHojaXlsx(bytes: Uint8Array): readonly (readonly string[])[] {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const z = new Descompresor(b, indiceZip(b));
  const compartidas = cadenasCompartidas(z.leer('xl/sharedStrings.xml'));
  const xml = z.leer(rutaPrimeraHoja(z));
  if (xml === undefined) throw new XlsxInvalido('hoja no encontrada');
  const filas: string[][] = [];
  let celdas = 0;
  let siguienteFila = 0;
  for (const mf of exigirXmlSeguro(xml).matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rAttr = atributo(mf[1] ?? '', 'r');
    const indiceFila = rAttr === undefined ? siguienteFila : Number(rAttr) - 1;
    if (!Number.isInteger(indiceFila) || indiceFila < 0 || indiceFila > MAX_FILA_INDICE) throw new XlsxInvalido('demasiadas filas');
    siguienteFila = indiceFila + 1;
    const fila: string[] = [];
    let siguienteCol = 0;
    for (const mc of (mf[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      if (++celdas > MAX_CELDAS) throw new XlsxInvalido('demasiadas celdas');
      const attrs = mc[1] ?? '';
      const ref = atributo(attrs, 'r');
      const col = ref === undefined ? siguienteCol : columnaDe(ref);
      if (col > MAX_COLUMNA_INDICE) throw new XlsxInvalido('demasiadas columnas');
      siguienteCol = col + 1;
      const interior = mc[2] ?? '';
      const tipo = atributo(attrs, 't');
      let valor: string;
      if (tipo === 'inlineStr') valor = textoDe(interior);
      else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(interior);
        const crudo = v === null ? '' : decodificar(v[1] ?? '');
        valor = tipo === 's' ? (compartidas[Number(crudo)] ?? '') : tipo === 'b' ? (crudo === '1' ? 'TRUE' : 'FALSE') : crudo;
      }
      while (fila.length < col) fila.push('');
      fila[col] = valor;
    }
    while (filas.length < indiceFila) filas.push([]);
    filas[indiceFila] = fila;
  }
  return filas;
}

/** Lector de hojas para el entorno: las filas del `.xlsx` como texto, o `XlsxInvalido` si el archivo no es de fiar. */
export function crearLectorHojas(): LectorHojas {
  return { leerPrimeraHoja: (bytes) => Promise.resolve().then(() => leerPrimeraHojaXlsx(bytes)) };
}
