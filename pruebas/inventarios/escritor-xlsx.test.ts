import { describe, expect, it } from 'vitest';
import { crearLectorHojas, leerPrimeraHojaXlsx } from '../../plataforma/coordinador/lector-hojas.js';
import { exportarProductosCsv, importarCsvPorLotes, leerArchivoImportacion, neutralizarCelda, simularImportacionCsv, type ProductoExportable } from './api.js';
import { ADM, altaProducto, COMERCIAL_TRES, nuevoEntorno, op, producto, T } from './entorno.js';

// La pieza vive en el panel (carpeta `src/`): la prueba la carga por ruta, sin importación profunda estática.
const RUTA_ESCRITOR = '../../paquetes/panel/src/pantallas/inventarios/escritor-xlsx.ts';
const RUTA_LOGICA = '../../paquetes/panel/src/pantallas/inventarios/importar-logica.ts';
type Escritor = typeof import('../../paquetes/panel/src/pantallas/inventarios/escritor-xlsx.js');
type Logica = typeof import('../../paquetes/panel/src/pantallas/inventarios/importar-logica.js');
const { escribirXlsx, filasDeExportacion, neutralizarCeldaXlsx } = (await import(/* @vite-ignore */ RUTA_ESCRITOR)) as Escritor;
const { hojasPlantilla } = (await import(/* @vite-ignore */ RUTA_LOGICA)) as Logica;
type Mercados = Parameters<Logica['hojasPlantilla']>[1];

const MERCADOS = [
  { id: 'BO', nombre: 'Bolivia', monedaVenta: 'BOB', monedaBase: 'USD', tieneTipoCambio: true },
  { id: 'AR', nombre: 'Argentina', monedaVenta: 'ARS', monedaBase: 'USD', tieneTipoCambio: true },
] as unknown as Mercados;

const sinCatalogo = (): Promise<never[]> => Promise.resolve([]);

describe('escritor xlsx leído por el lector del servidor', () => {
  it('ida y vuelta con tildes, comas, comillas, saltos de línea y CR', () => {
    const filas = [['nombre', 'nota'], ['Cañón & «luz» <b>', 'a, "b"\nc'], ['x', ''], ['', 'solo segunda'], ['p\rq', 'z']];
    expect(leerPrimeraHojaXlsx(escribirXlsx([{ nombre: 'Productos', filas }]))).toEqual([['nombre', 'nota'], ['Cañón & «luz» <b>', 'a, "b"\nc'], ['x'], ['', 'solo segunda'], ['p\rq', 'z']]);
  });

  it('lee solo la primera hoja', () => {
    expect(leerPrimeraHojaXlsx(escribirXlsx([{ nombre: 'Productos', filas: [['a']] }, { nombre: 'Instrucciones', filas: [['b']] }]))).toEqual([['a']]);
  });

  it('la neutralización del panel es la misma que la del servidor, con los mismos casos', () => {
    const casos = ['=1+1', '+54', '-2', '@SUMA(A1)', '\tx', '\rx', "'=ya", "''-x", 'normal', "'normal", '', 'a=b', ' =x'];
    for (const c of casos) expect(neutralizarCeldaXlsx(c)).toBe(neutralizarCelda(c));
    const leido = leerPrimeraHojaXlsx(escribirXlsx([{ nombre: 'H', filas: casos.filter((c) => c !== '').map((c) => [c]) }]));
    expect(leido.map((f) => f[0])).toEqual(casos.filter((c) => c !== '').map((c) => neutralizarCelda(c)));
  });

  it('celdas que empiezan con CR o con U+0001 no llegan como fórmula ni rompen el archivo', () => {
    const leido = leerPrimeraHojaXlsx(escribirXlsx([{ nombre: 'H', filas: [['\r=x'], ['\u0001=x'], ['\u0001ok']] }]));
    expect(leido.map((f) => f[0])).toEqual(["'\r=x", "'=x", 'ok']);
  });
});

describe('plantilla y exportación en Excel con el lector real', () => {
  it('la plantilla se reconoce al importarla: la fila de ejemplo se simula como producto nuevo y sin errores', async () => {
    const db = await nuevoEntorno();
    const f = await leerArchivoImportacion(escribirXlsx(hojasPlantilla(false, MERCADOS, 'USD')), crearLectorHojas());
    const sim = await db.runTransaction((tx) => simularImportacionCsv(tx, { catalogo: sinCatalogo, tenantId: T, por: ADM, csv: f }));
    expect(sim.filas).toHaveLength(1);
    expect(sim.filas[0]).toMatchObject({ accion: 'crear', errores: [] });
  });

  it('exportar, pasar a Excel, leer con el lector real e importar da «sin cambios», también con nombres raros', async () => {
    const db = await nuevoEntorno();
    const datos: { id: string; nombre: string; marca?: string; bo: number; ar: number; costo: number; pub: boolean }[] = [
      { id: 'p-a', nombre: '=x', bo: 10, ar: 123450, costo: 800, pub: true },
      { id: 'p-b', nombre: '-x', marca: 'Sonora', bo: 99999999, ar: 5, costo: 1, pub: false },
      { id: 'p-c', nombre: 'Cable, "largo" de 2 m', bo: 1250, ar: 0, costo: 123450, pub: true },
    ];
    // La marca vacía queda en una columna intermedia (entre categoría y SKU).
    const exportables: ProductoExportable[] = datos.map((d) => ({
      id: d.id, nombre: d.nombre, categoria: 'general', ...(d.marca === undefined ? {} : { marca: d.marca }), sku: `SKU-${d.id}`, conSerie: false,
      precioUSD: { bo: d.bo, ar: d.ar }, costoUSD: d.costo, activo: true, publicado: d.pub,
    }));
    for (const x of exportables) await altaProducto(db, producto(x.id, { nombre: x.nombre, categoria: 'general', ...(x.marca === undefined ? {} : { marca: x.marca }), sku: x.sku, precioUSD: x.precioUSD as { bo: number; ar: number }, costoUSD: x.costoUSD as number, publicado: x.publicado }));
    const csv = exportarProductosCsv(exportables, COMERCIAL_TRES);
    const libro = escribirXlsx([{ nombre: 'Productos', filas: filasDeExportacion(csv) }]);
    const f = await leerArchivoImportacion(libro, crearLectorHojas());
    const sim = await db.runTransaction((tx) => simularImportacionCsv(tx, { catalogo: sinCatalogo, tenantId: T, por: ADM, csv: f }));
    expect(sim.filas.flatMap((x) => x.errores)).toEqual([]);
    expect(sim.filas.map((x) => x.accion)).toEqual(Array(datos.length).fill('sin-cambios'));
    const r = await importarCsvPorLotes(db, { catalogo: sinCatalogo, tenantId: T, operacionId: op('xlsx'), por: ADM, csv: f });
    expect(r.completa).toBe(true);
  });
});
