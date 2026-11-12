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
    const t = (x: string) => Buffer.from(x);
    const libro = zip([
      { nombre: 'xl/workbook.xml', datos: t('<workbook xmlns:r="r"><sheets><sheet name="H" sheetId="1" r:id="rId1"/></sheets></workbook>') },
      { nombre: 'xl/_rels/workbook.xml.rels', datos: t(rels) },
    ]);
    await expect(leer(libro)).rejects.toThrow('ruta de hoja inválida');
  });

  it('ZIP con un nombre de entrada repetido se rechaza (no gana la última)', async () => {
    const t = (x: string) => Buffer.from(x);
    const b = zip([{ nombre: 'xl/workbook.xml', datos: t('<a/>') }, { nombre: 'xl/workbook.xml', datos: t('<b/>') }]);
    await expect(leer(b)).rejects.toThrow('duplicada');
  });

  it('una entrada que supera el tope de 4 MB descomprimida se rechaza', async () => {
    const hoja = `<worksheet><sheetData>${' '.repeat(4 * 1024 * 1024 + 1)}</sheetData></worksheet>`;
    await expect(leer(xlsx([['id']], [], hoja))).rejects.toBeInstanceOf(XlsxInvalido);
  });
});

describe('etiquetas sin cierre (retroceso cuadrático, CWE-1333)', () => {
  const hojaCon = (relleno: string) => `<worksheet><sheetData>${relleno}</sheetData></worksheet>`;
  const casos: [string, Buffer][] = [
    ['<row> sin cierre', xlsx([['id']], [], hojaCon('<row>'.repeat(60_000)))],
    ['<c> sin cierre', xlsx([['id']], [], hojaCon(`<row r="1">${'<c>'.repeat(60_000)}</row>`))],
    ['<v> sin cierre', xlsx([['id']], [], hojaCon(`<row r="1"><c r="A1">${'<v>'.repeat(60_000)}</c></row>`))],
    ['<row sin >', xlsx([['id']], [], hojaCon('<row '.repeat(60_000)))],
  ];
  const sst = (cuerpo: string) => zip([
    { nombre: 'xl/sharedStrings.xml', datos: Buffer.from(`<sst>${cuerpo}</sst>`) },
    { nombre: 'xl/workbook.xml', datos: Buffer.from('<workbook xmlns:r="r"><sheets><sheet name="H" r:id="rId1"/></sheets></workbook>') },
    { nombre: 'xl/_rels/workbook.xml.rels', datos: Buffer.from('<Relationships><Relationship Id="rId1" Target="worksheets/s.xml"/></Relationships>') },
    { nombre: 'xl/worksheets/s.xml', datos: Buffer.from('<worksheet><sheetData/></worksheet>') },
  ]);
  casos.push(
    ['<si> sin cierre', sst('<si>'.repeat(60_000))],
    ['<t> sin cierre', sst(`<si>${'<t>'.repeat(60_000)}</si>`)],
    ['<rPh> sin cierre', sst(`<si><t>x</t>${'<rPh>'.repeat(60_000)}</si>`)],
  );

  for (const [nombre, archivo] of casos) {
    it(`${nombre}: XlsxInvalido en menos de 500 ms`, async () => {
      const t0 = performance.now();
      await expect(leer(archivo)).rejects.toBeInstanceOf(XlsxInvalido);
      expect(performance.now() - t0).toBeLessThan(500);
    });
  }

  it('peor caso admitido (hoja de 3 MB con 200 000 celdas): se lee en menos de 400 ms', async () => {
    const filas = Array.from({ length: 2_000 }, (_, r) => `<row r="${String(r + 1)}">${Array.from({ length: 100 }, () => '<c><v>1</v></c>').join('')}</row>`).join('');
    const b = xlsx([['id']], [], hojaCon(filas));
    const t0 = performance.now();
    const salida = await leer(b);
    const ms = performance.now() - t0;
    console.info(`peor caso admitido: ${ms.toFixed(1)} ms`);
    expect(salida.length).toBe(2_000);
    expect(ms).toBeLessThan(400);
  });
});
