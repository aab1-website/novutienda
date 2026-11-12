// Lector de .xlsx del coordinador (`LectorHojas` de Inventarios): lee la primera hoja como texto y resiste archivos hostiles.
import { leerArchivoImportacion } from '@novutienda/inventarios';
import { describe, expect, it } from 'vitest';
import { crearLectorHojas, XlsxInvalido } from '../../plataforma/coordinador/index.js';
import { xlsx, zip } from '../funciones/xlsx-ayuda.js';

const lector = crearLectorHojas();
const leer = (b: Buffer) => lector.leerPrimeraHoja(new Uint8Array(b));

describe('lectura de la primera hoja', () => {
  it('devuelve texto, números y celdas vacías en su columna', async () => {
    const b = xlsx([['id', 'nombre', 'precio'], ['a-1', 'Lápiz & goma <HB>', 12.5], ['a-2', null, 3]]);
    expect(await leer(b)).toEqual([['id', 'nombre', 'precio'], ['a-1', 'Lápiz & goma <HB>', '12.5'], ['a-2', '', '3']]);
  });

  it('no evalúa fórmulas: entrega el valor guardado, nunca el texto de la fórmula', async () => {
    const filas = await leer(xlsx([['id'], ['=HYPERLINK("http://x","y")']]));
    expect(filas[1]).toEqual(['valor-guardado']);
  });

  it('el CSV y el xlsx por la firma: leerArchivoImportacion usa el lector', async () => {
    const filas = await leerArchivoImportacion(new Uint8Array(xlsx([['id', 'nombre'], ['x-1', 'Uno']])), lector);
    expect(filas).toEqual([['id', 'nombre'], ['x-1', 'Uno']]);
  });
});

describe('archivos no confiables', () => {
  it('bomba de descompresión: una hoja que declara poco pero expande 100 MB se corta', async () => {
    const enorme = Buffer.concat([Buffer.from('<worksheet><sheetData>'), Buffer.alloc(100 * 1024 * 1024, 0x20), Buffer.from('</sheetData></worksheet>')]);
    const b = xlsx([['id']], [], enorme.toString('latin1'));
    expect(b.length).toBeLessThan(1024 * 1024);
    await expect(leer(b)).rejects.toBeInstanceOf(XlsxInvalido);
  });

  it('demasiadas entradas en el ZIP', async () => {
    const muchas = Array.from({ length: 300 }, (_, i) => ({ nombre: `relleno/${String(i)}.xml`, datos: Buffer.from('x') }));
    await expect(leer(xlsx([['id']], muchas))).rejects.toBeInstanceOf(XlsxInvalido);
  });

  it('XML con DOCTYPE o ENTITY (XXE, billion laughs) se rechaza sin resolver nada', async () => {
    const hoja = '<!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&x;</t></is></c></row></sheetData></worksheet>';
    await expect(leer(xlsx([['id']], [], hoja))).rejects.toBeInstanceOf(XlsxInvalido);
  });

  it('referencias fuera de tope: columna 5000 o fila 1 000 000', async () => {
    await expect(leer(xlsx([['id']], [], '<worksheet><sheetData><row r="1"><c r="ZZZ1"><v>1</v></c></row></sheetData></worksheet>'))).rejects.toBeInstanceOf(XlsxInvalido);
    await expect(leer(xlsx([['id']], [], '<worksheet><sheetData><row r="1000000"><c r="A1"><v>1</v></c></row></sheetData></worksheet>'))).rejects.toBeInstanceOf(XlsxInvalido);
  });

  it('ZIP sin directorio central, ZIP cifrado o libro sin hojas', async () => {
    await expect(leer(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]))).rejects.toBeInstanceOf(XlsxInvalido);
    await expect(leer(zip([{ nombre: 'otro.txt', datos: Buffer.from('hola') }]))).rejects.toBeInstanceOf(XlsxInvalido);
    const cifrado = xlsx([['id']]);
    cifrado.writeUInt16LE(1, cifrado.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 8);
    await expect(leer(cifrado)).rejects.toBeInstanceOf(XlsxInvalido);
  });

  it('ruta de hoja con «..» no sale del libro', async () => {
    const rels = '<Relationships><Relationship Id="rId1" Type="x" Target="../../secreto.xml"/></Relationships>';
    await expect(leer(xlsx([['id']], [{ nombre: 'xl/_rels/workbook.xml.rels', datos: Buffer.from(rels) }]))).rejects.toBeInstanceOf(XlsxInvalido);
  });
});
