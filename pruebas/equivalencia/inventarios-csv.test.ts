// (e) CSV exportado de productos y simulación de importación de un CSV con `precioBO` / `precioAR`, con las
// funciones reales de Inventarios sobre los productos fijos. La simulación no escribe: se comprueba.
import { exportarProductosCsv, simularImportacionCsv, type ProductoExportable } from '@novutienda/inventarios';
import { describe, expect, it } from 'vitest';
import { ADM, T } from './escenario.js';
import { crearEscenario } from './escenario.js';
import { compararConFoto, compararConFotoJson } from './foto.js';

const exportables = async (): Promise<{ e: Awaited<ReturnType<typeof crearEscenario>>; productos: ProductoExportable[] }> => {
  const e = await crearEscenario();
  const productos = e.db.coleccion(`tenants/${T}/productos`).sort((a, b) => a.id.localeCompare(b.id)).map(({ id, datos: d }) => ({
    id, nombre: d['nombre'] as string, categoria: d['categoria'] as string, sku: d['sku'] as string, conSerie: d['conSerie'] === true,
    precioUSD: d['precioUSD'] as { bo: number; ar: number }, activo: d['activo'] === true, publicado: d['publicado'] === true,
    ...(typeof d['marca'] === 'string' ? { marca: d['marca'] } : {}),
    ...(typeof d['garantiaMeses'] === 'number' ? { garantiaMeses: d['garantiaMeses'] } : {}),
    ...(typeof d['minimo'] === 'number' ? { minimo: d['minimo'] } : {}),
  }));
  return { e, productos };
};

describe('CSV de productos del tenant de referencia', () => {
  it('exportación: columnas, precios en USD con dos decimales (precioBO / precioAR), precios en 0 y decimales incómodos', async () => {
    const { productos } = await exportables();
    const csv = exportarProductosCsv(productos);
    expect(csv.split('\r\n')[0]).toContain('precioBO,precioAR');
    compararConFoto('inventarios-exportacion.csv', csv);
  });

  it('simulación: volver a importar lo exportado no cambia nada', async () => {
    const { e, productos } = await exportables();
    const sim = await e.db.runTransaction((tx) => simularImportacionCsv(tx, { tenantId: T, por: ADM, csv: exportarProductosCsv(productos), cargaInicial: false }));
    expect(sim.resumen.errores).toBe(0);
    expect(sim.resumen.crear + sim.resumen.actualizar).toBe(0);
    compararConFotoJson('inventarios-simulacion-roundtrip.json', sim);
  });

  it('simulación: alta, cambio de precio en un solo mercado, precio 0, formatos de número y filas con error', async () => {
    const { e, productos } = await exportables();
    const base = exportarProductosCsv(productos).split('\r\n');
    const filaLapiz = base.findIndex((l) => l.startsWith('p-lapiz,'));
    base[filaLapiz] = 'p-lapiz,Lápiz HB,general,,SKU-p-lapiz,false,,,1.30,1.33,,true,true'; // solo cambia precioBO
    const csv = [
      ...base.filter((l) => l !== ''),
      'p-nuevo,Producto nuevo,general,,SKU-p-nuevo,false,,,"12,5",0,,true,true', // alta con precio en un solo mercado
      'p-grande,Producto grande,general,,SKU-p-grande,false,,,"1.234,56",99.99,,true,true', // separadores de miles y decimales
      'MAL ID,x,general,,SKU-x,false,,,1,1,,true,true',
      'p-raro,Raro,general,,SKU-raro,false,,,abc,1,,true,true',
      'p-negativo,Negativo,general,,SKU-neg,false,,,-5,1,,true,true',
    ].join('\r\n') + '\r\n';
    const antes = JSON.stringify([...e.db.docs]);
    const sim = await e.db.runTransaction((tx) => simularImportacionCsv(tx, { tenantId: T, por: ADM, csv, cargaInicial: false }));
    expect(JSON.stringify([...e.db.docs])).toBe(antes); // simular no escribe
    compararConFotoJson('inventarios-simulacion-cambios.json', { csv, simulacion: sim });
  });
});
