import { beforeEach, describe, expect, it } from 'vitest';
import { exportarProductosCsv, importarCsvPorLotes, leerArchivoImportacion, simularImportacionCsv, type LectorHojas, type ProductoExportable } from './api.js';
import type { DobleDb } from './doble-db.js';
import { ADM, altaProducto, COMERCIAL_TRES, nuevoEntorno, op, producto, T } from './entorno.js';

let db: DobleDb;
beforeEach(async () => {
  db = await nuevoEntorno();
});
const sinCatalogo = (): Promise<never[]> => Promise.resolve([]);
const ZIP = Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 1, 2, 3);
const lectorCon = (hoja: readonly (readonly string[])[]): LectorHojas => ({ leerPrimeraHoja: () => Promise.resolve(hoja) });
const simular = (csv: Awaited<ReturnType<typeof leerArchivoImportacion>>) => db.runTransaction((tx) => simularImportacionCsv(tx, { catalogo: sinCatalogo, tenantId: T, por: ADM, csv }));

describe('Excel exportado e importado', () => {
  it('la hoja del Excel (con sí/no, como la arma el panel) importada da «sin cambios»', async () => {
    const datos: [string, number, number, number, boolean][] = [['p-a', 10, 123450, 800, true], ['p-b', 99999999, 5, 1, false]];
    for (const [id, bo, ar, costo, pub] of datos) await altaProducto(db, producto(id, { precioUSD: { bo, ar }, sku: `SKU-${id}`, nombre: `Prod ${id}`, costoUSD: costo, publicado: pub }));
    const exportables: ProductoExportable[] = datos.map(([id, bo, ar, costo, pub]) => ({
      id, nombre: `Prod ${id}`, categoria: 'general', sku: `SKU-${id}`, conSerie: false, precioUSD: { bo, ar }, costoUSD: costo, activo: true, publicado: pub,
    }));
    const csv = exportarProductosCsv(exportables, COMERCIAL_TRES);
    const [cab = '', ...filas] = csv.trim().split('\r\n');
    const hoja = [cab.split(','), ...filas.map((f) => f.split(',').map((v) => (v === 'true' ? 'sí' : v === 'false' ? 'no' : v)))];
    const f = await leerArchivoImportacion(ZIP, lectorCon(hoja));
    const sim = await simular(f);
    expect(sim.filas.every((x) => x.errores.length === 0)).toBe(true);
    expect(sim.filas.map((x) => x.accion)).toEqual(['sin-cambios', 'sin-cambios']);
    const r = await importarCsvPorLotes(db, { catalogo: sinCatalogo, tenantId: T, operacionId: op('xlsx'), por: ADM, csv: f });
    expect(r.completa).toBe(true);
  });

  it('la fila de ejemplo de la plantilla se simula como producto nuevo y sin errores', async () => {
    const hoja = [
      ['nombre', 'categoria', 'marca', 'sku', 'conSerie', 'garantiaMeses', 'minimo', 'precioBO', 'precioAR', 'costo', 'activo', 'publicado'],
      ['Auricular inalámbrico', 'audio', 'Sonora', 'AUR-001', 'no', '12', '5', '1234.50', '1234.50', '800.00', 'sí', 'no'],
    ];
    const sim = await simular(await leerArchivoImportacion(ZIP, lectorCon(hoja)));
    expect(sim.filas[0]).toMatchObject({ accion: 'crear', errores: [] });
  });
});
