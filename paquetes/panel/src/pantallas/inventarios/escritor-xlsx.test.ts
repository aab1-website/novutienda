import { describe, expect, it } from 'vitest';
import type { MercadoDeclarado } from '../../api/tipos.js';
import { crc32, escribirXlsx, filasDeExportacion, leerCsvPropio, neutralizarCeldaXlsx } from './escritor-xlsx.js';
import { columnasArchivo, hojasPlantilla } from './importar-logica.js';

const MERCADOS = [
  { id: 'BO', nombre: 'Bolivia', monedaVenta: 'BOB', monedaBase: 'USD', tieneTipoCambio: true },
  { id: 'AR', nombre: 'Argentina', monedaVenta: 'ARS', monedaBase: 'USD', tieneTipoCambio: true },
] as unknown as readonly MercadoDeclarado[];

/** Contenido de cada entrada del ZIP (solo modo store), leído por el directorio central. */
function entradas(b: Uint8Array): Map<string, string> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const dec = new TextDecoder();
  const salida = new Map<string, string>();
  let pos = v.getUint32(b.length - 22 + 16, true);
  const total = v.getUint16(b.length - 22 + 10, true);
  for (let i = 0; i < total; i++) {
    const tam = v.getUint32(pos + 20, true);
    const largoNombre = v.getUint16(pos + 28, true);
    const desp = v.getUint32(pos + 42, true);
    const nombre = dec.decode(b.subarray(pos + 46, pos + 46 + largoNombre));
    const ini = desp + 30 + v.getUint16(desp + 26, true) + v.getUint16(desp + 28, true);
    const crudo = b.subarray(ini, ini + tam);
    salida.set(nombre, dec.decode(crudo));
    pos += 46 + largoNombre + v.getUint16(pos + 30, true) + v.getUint16(pos + 32, true);
  }
  return salida;
}

describe('escritor xlsx', () => {
  it('CRC32 conocido', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('un número negativo no lleva apóstrofe, pero el texto «-2» sí', () => {
    const libro = entradas(escribirXlsx([{ nombre: 'H', filas: [[-3, '-3']] }]));
    const hoja = [...libro.values()].find((x) => x.includes('<sheetData>')) ?? '';
    expect(hoja).toContain('>-3</t>');
    expect(hoja).toContain(">'-3</t>");
  });

  it('neutraliza con un apóstrofe lo que empieza con = + - @, TAB o CR, y lo ya neutralizado', () => {
    for (const c of ['=1+1', '+54', '-2', '@SUMA(A1)', '\tx', '\rx', "'=ya"]) expect(neutralizarCeldaXlsx(c)).toBe(`'${c}`);
    expect(neutralizarCeldaXlsx('normal')).toBe('normal');
    expect(neutralizarCeldaXlsx("'normal")).toBe("'normal");
  });

  it('el CR va como referencia numérica y los caracteres no admitidos por XML se quitan antes de neutralizar', () => {
    const e = entradas(escribirXlsx([{ nombre: 'H', filas: [['a\rb'], ['\u0001=x'], ['￾y￿'], [12.5]] }]));
    const hoja = e.get('xl/worksheets/sheet1.xml') ?? '';
    expect(hoja).toContain('a&#13;b');
    expect(hoja).not.toContain('\r');
    expect(hoja).toContain("'=x");
    for (const c of [String.fromCharCode(1), String.fromCharCode(0xfffe), String.fromCharCode(0xffff)]) expect(hoja.includes(c)).toBe(false);
    expect(hoja).toContain('>y<');
  });

  it('el libro trae estilos mínimos con su relación y su tipo de contenido', () => {
    const e = entradas(escribirXlsx([{ nombre: 'H', filas: [['a']] }]));
    expect(e.get('xl/styles.xml')).toContain('<styleSheet');
    expect(e.get('xl/_rels/workbook.xml.rels')).toContain('relationships/styles');
    expect(e.get('[Content_Types].xml')).toContain('/xl/styles.xml');
  });
});

describe('plantilla y exportación en Excel', () => {
  it('la plantilla trae el SKU, un precio por mercado y sí/no, y la hoja de instrucciones documenta cada columna', () => {
    const hojas = hojasPlantilla(true, MERCADOS, 'USD');
    const cab = hojas[0]?.filas[0] ?? [];
    expect(cab).toEqual([...columnasArchivo(MERCADOS, 'USD').map((c) => c.nombre), 'stockTienda', 'stockDeposito1', 'stockDeposito2']);
    expect(cab).toEqual(expect.arrayContaining(['sku', 'precioBO', 'precioAR', 'conSerie', 'activo', 'publicado']));
    const ins = hojas[1]?.filas ?? [];
    expect(ins[0]).toEqual(['Columna', 'Qué lleva', 'Formato', '¿Es obligatoria?', 'Ejemplo']);
    expect(ins.length - 1).toBeGreaterThanOrEqual(cab.length);
    expect(JSON.stringify(ins)).toContain('Hasta 40 caracteres: letras, números, punto, guion y guion bajo');
    expect(hojas[0]?.filas[1]?.[cab.indexOf('conSerie')]).toBe('no');
  });

  it('la exportación pasa true/false a sí/no solo en el Excel y quita la neutralización del CSV', () => {
    const csv = 'nombre,categoria,marca,sku,conSerie,activo,publicado\r\n\'=raro,c,,S-1,false,true,false\r\n';
    const filas = filasDeExportacion(csv);
    expect(filas[1]).toEqual(['=raro', 'c', '', 'S-1', 'no', 'sí', 'no']);
    expect(leerCsvPropio(csv)).toHaveLength(2);
  });
});
