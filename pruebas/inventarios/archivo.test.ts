import { beforeEach, describe, expect, it } from 'vitest';
import {
  centavosAUsd, columnasDeExportacion, EntradaInvalida, exportarProductosCsv, importarCsvPorLotes, leerArchivoImportacion, MAX_BYTES_ARCHIVO,
  MAX_COLUMNAS_ARCHIVO, MAX_FILAS_ARCHIVO, simularImportacionCsv, type FuenteTabla, type LectorHojas, type ProductoExportable,
} from './api.js';
import type { DobleDb } from './doble-db.js';
import { ADM, altaProducto, COMERCIAL_TRES, doc, nuevoEntorno, op, producto, T } from './entorno.js';

let db: DobleDb;
beforeEach(async () => {
  db = await nuevoEntorno();
});

const ZIP = Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 1, 2, 3);
const bytes = (t: string): Uint8Array => new TextEncoder().encode(t);
/** Doble del puerto: devuelve una hoja fija o falla como una librería ante un zip corrupto. */
const lectorCon = (hoja: readonly (readonly string[])[]): LectorHojas => ({ leerPrimeraHoja: () => Promise.resolve(hoja) });
const HOJA = [
  ['id', 'nombre', 'categoria', 'sku', 'precioBO', 'precioAR'],
  ['xl-1', 'Hoja uno', 'c', 'XL-1', '12.50', '0.10'],
  ['xl-2', 'Hoja dos', 'c'], // fila corta: celdas finales vacías
];
const simular = (f: FuenteTabla) => db.runTransaction((tx) => simularImportacionCsv(tx, { tenantId: T, por: ADM, csv: f }));

describe('lectura de archivos (csv o xlsx por firma)', () => {
  it('xlsx con el doble del puerto: simulación e importación real', async () => {
    const filas = await leerArchivoImportacion(ZIP, lectorCon(HOJA));
    const sim = await simular(filas);
    // La segunda fila es nueva y sin SKU: error por fila y columna (se exige SKU; no se inventa).
    expect(sim.filas.map((f) => f.accion)).toEqual(['crear', 'error']);
    expect(sim.filas[1]?.errores).toEqual([{ columna: 'sku', motivo: 'es obligatorio para crear' }]);
    const r = await importarCsvPorLotes(db, { tenantId: T, operacionId: op('xl'), por: ADM, csv: filas, omitirErrores: true, lineasOmitidas: [3] });
    expect(r).toMatchObject({ completa: true, creados: 1, omitidas: 1 });
    expect(doc(db, 'productos', 'xl-1')?.['precioUSD']).toEqual({ bo: 1250, ar: 10 });
    expect(doc(db, 'productos', 'xl-2')).toBeUndefined();
  });

  it('csv en bytes (con BOM) da lo mismo que el texto', async () => {
    const filas = await leerArchivoImportacion(bytes('﻿id,nombre\r\na1,"x, y"\r\n'));
    expect(filas).toEqual([['id', 'nombre'], ['a1', 'x, y']]);
  });

  it('xlsx sin lector inyectado: error claro (no es un fallo interno)', async () => {
    await expect(leerArchivoImportacion(ZIP)).rejects.toMatchObject({ codigo: 'failed-precondition', message: expect.stringContaining('Excel') });
  });

  it('archivo que no es csv ni xlsx, vacío o zip corrupto', async () => {
    await expect(leerArchivoImportacion(Uint8Array.of(0xff, 0xfe, 0x80, 0x81))).rejects.toThrow(/ni Excel/);
    await expect(leerArchivoImportacion(Uint8Array.of(0x41, 0x00, 0x42))).rejects.toThrow(/ni Excel/);
    await expect(leerArchivoImportacion(new Uint8Array())).rejects.toThrow(/vacío/);
    const roto: LectorHojas = { leerPrimeraHoja: () => Promise.reject(new Error('zip roto con detalle interno')) };
    const e = await leerArchivoImportacion(ZIP, roto).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(EntradaInvalida);
    expect((e as Error).message).not.toContain('detalle interno');
  });

  it('topes: bytes, filas, columnas y celda (también sobre lo que devuelve el lector)', async () => {
    await expect(leerArchivoImportacion(new Uint8Array(MAX_BYTES_ARCHIVO + 1).fill(65))).rejects.toThrow(/2 MB/);
    const muchas = [['id'], ...Array.from({ length: MAX_FILAS_ARCHIVO + 1 }, (_, i) => [`p${String(i)}`])];
    await expect(leerArchivoImportacion(ZIP, lectorCon(muchas))).rejects.toThrow(/filas/);
    await expect(leerArchivoImportacion(bytes(muchas.map((f) => f.join(',')).join('\n')))).rejects.toThrow(/filas/);
    await expect(leerArchivoImportacion(ZIP, lectorCon([Array.from({ length: MAX_COLUMNAS_ARCHIVO + 1 }, (_, i) => `c${String(i)}`)]))).rejects.toThrow(/columnas/);
    await expect(leerArchivoImportacion(ZIP, lectorCon([['id'], ['x'.repeat(1001)]]))).rejects.toThrow(/celda/);
    await expect(leerArchivoImportacion(ZIP, lectorCon([]))).rejects.toThrow(/encabezado/);
  });

  it('una celda de fórmula no se ejecuta ni se guarda como fórmula', async () => {
    const sim = await simular([['id', 'nombre', 'categoria', 'sku'], ['f-1', '=HYPERLINK("x")', 'c', 'F-1']]);
    expect(sim.filas[0]?.accion).toBe('crear');
    expect(sim.filas[0]?.advertencias[0]).toContain('fórmula');
  });
});

describe('fila nueva sin SKU', () => {
  it('la simulación la marca por fila y columna, también desde CSV', async () => {
    const sim = await simular('id,nombre,categoria,precioBO\nsin-sku,Algo,c,1\n');
    expect(sim.filas[0]).toMatchObject({ accion: 'error', linea: 2, errores: [{ columna: 'sku', motivo: 'es obligatorio para crear' }] });
  });
});

describe('exportación en USD con decimales: ida y vuelta', () => {
  it('centavos a USD sin coma flotante', () => {
    expect([0, 10, 5, 1250, 123450, 99999999, 100].map(centavosAUsd)).toEqual(['0.00', '0.10', '0.05', '12.50', '1234.50', '999999.99', '1.00']);
  });

  it('encabezados y valores', () => {
    const csv = exportarProductosCsv([{ id: 'a1', nombre: 'A', categoria: 'c', sku: 'S-1', conSerie: false, precioUSD: { bo: 1250, ar: 10 }, costoUSD: 800, activo: true, publicado: true }]);
    const [cab, fila] = csv.split('\r\n');
    expect(cab?.split(',')).toEqual([...columnasDeExportacion(COMERCIAL_TRES)]);
    expect(cab).toContain('precioBO,precioAR,costo,');
    expect(fila).toBe('a1,A,c,,S-1,false,,,12.50,0.10,8.00,true,true');
  });

  it('reimportar lo exportado no cambia ningún precio ni costo', async () => {
    const precios: [string, number, number, number][] = [['p-a', 10, 123450, 800], ['p-b', 99999999, 5, 1], ['p-c', 1250, 0, 123450]];
    for (const [id, bo, ar] of precios) await altaProducto(db, producto(id, { precioUSD: { bo, ar }, sku: `SKU-${id}` }));
    const exportables: ProductoExportable[] = precios.map(([id, bo, ar, costo]) => ({
      id, nombre: id, categoria: 'general', sku: `SKU-${id}`, conSerie: false, precioUSD: { bo, ar }, costoUSD: costo, activo: true, publicado: true,
    }));
    const csv = exportarProductosCsv(exportables);
    expect(csv).toContain('0.10,1234.50,8.00');
    const sim = await simular(csv);
    const precioCambiado = sim.filas.filter((f) => f.cambios.includes('precioUSD'));
    expect(precioCambiado).toEqual([]);
    expect(sim.filas.every((f) => f.errores.length === 0)).toBe(true);
    const r = await importarCsvPorLotes(db, { tenantId: T, operacionId: op('ida'), por: ADM, csv });
    expect(r.completa).toBe(true);
    for (const [id, bo, ar] of precios) expect(doc(db, 'productos', id)?.['precioUSD']).toEqual({ bo, ar });
  });

  it('el formato en centavos sigue valiendo', async () => {
    const sim = await simular('id,nombre,categoria,sku,precioUSDbo,precioUSDar,costoUSD\nc-1,N,c,C-1,1250,10,800\n');
    expect(sim.filas[0]?.accion).toBe('crear');
  });
});
