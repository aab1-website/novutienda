import { describe, expect, it } from 'vitest';
import { crearLectorHojas, leerPrimeraHojaXlsx } from '../../plataforma/coordinador/lector-hojas.js';
import { leerArchivoImportacion, simularImportacionCsv } from './api.js';
import { ADM, nuevoEntorno, T } from './entorno.js';

// La pieza vive en el panel (carpeta `src/`): la prueba la carga por ruta, sin importación profunda estática.
const RUTA_ESCRITOR = '../../paquetes/panel/src/pantallas/inventarios/escritor-xlsx.ts';
const RUTA_LOGICA = '../../paquetes/panel/src/pantallas/inventarios/importar-logica.ts';
type Escritor = typeof import('../../paquetes/panel/src/pantallas/inventarios/escritor-xlsx.js');
type Logica = typeof import('../../paquetes/panel/src/pantallas/inventarios/importar-logica.js');
const { crc32, escribirXlsx, filasDeExportacion, leerCsvPropio } = (await import(/* @vite-ignore */ RUTA_ESCRITOR)) as Escritor;
const { columnasArchivo, hojasPlantilla } = (await import(/* @vite-ignore */ RUTA_LOGICA)) as Logica;
type Mercados = Parameters<Logica['hojasPlantilla']>[1];

const MERCADOS = [
  { id: 'BO', nombre: 'Bolivia', monedaVenta: 'BOB', monedaBase: 'USD', tieneTipoCambio: true },
  { id: 'AR', nombre: 'Argentina', monedaVenta: 'ARS', monedaBase: 'USD', tieneTipoCambio: true },
] as unknown as Mercados;

describe('escritor xlsx', () => {
  it('CRC32 conocido', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('ida y vuelta con el lector del servidor, con tildes, comas, comillas y saltos de línea', () => {
    const filas = [['nombre', 'nota'], ['Cañón & «luz» <b>', 'a, "b"\nc'], ['x', ''], ['', 'solo segunda']];
    const leido = leerPrimeraHojaXlsx(escribirXlsx([{ nombre: 'Productos', filas }]));
    expect(leido).toEqual([['nombre', 'nota'], ['Cañón & «luz» <b>', 'a, "b"\nc'], ['x'], ['', 'solo segunda']]);
  });

  it('lee solo la primera hoja y no se confunde con la segunda', () => {
    const b = escribirXlsx([{ nombre: 'Productos', filas: [['a']] }, { nombre: 'Instrucciones', filas: [['b']] }]);
    expect(leerPrimeraHojaXlsx(b)).toEqual([['a']]);
  });

  it('neutraliza las celdas peligrosas con un apóstrofe', () => {
    const peligrosas = ['=SUMA(A1)', '+1', '-1', '@x', '\tx', '\rx', "'=ya"];
    const leido = leerPrimeraHojaXlsx(escribirXlsx([{ nombre: 'H', filas: peligrosas.map((v) => [v]) }]));
    expect(leido.map((f) => f[0])).toEqual(peligrosas.map((v) => `'${v}`));
    expect(leerPrimeraHojaXlsx(escribirXlsx([{ nombre: 'H', filas: [['normal', 12.5, true]] }]))).toEqual([['normal', '12.5', 'sí']]);
  });

});

describe('plantilla y exportación en Excel', () => {
  it('la plantilla trae el SKU, un precio por mercado y sí/no, y la hoja de instrucciones documenta cada columna', () => {
    const hojas = hojasPlantilla(true, MERCADOS, 'USD');
    const libro = escribirXlsx(hojas);
    const cab = leerPrimeraHojaXlsx(libro)[0] ?? [];
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
    expect(leerPrimeraHojaXlsx(escribirXlsx([{ nombre: 'Productos', filas }]))[1]).toEqual(["'=raro", 'c', '', 'S-1', 'no', 'sí', 'no']);
  });

  it('la plantilla se reconoce al importarla: la fila de ejemplo se simula como producto nuevo y sin errores', async () => {
    const db = await nuevoEntorno();
    const f = await leerArchivoImportacion(escribirXlsx(hojasPlantilla(false, MERCADOS, 'USD')), crearLectorHojas());
    const sim = await db.runTransaction((tx) => simularImportacionCsv(tx, { catalogo: () => Promise.resolve([]), tenantId: T, por: ADM, csv: f }));
    expect(sim.filas).toHaveLength(1);
    expect(sim.filas[0]).toMatchObject({ accion: 'crear', errores: [] });
  });
});
