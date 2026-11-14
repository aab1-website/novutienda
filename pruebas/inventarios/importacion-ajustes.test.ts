import { beforeEach, describe, expect, it } from 'vitest';
import {
  aEnteroEscalado, deshacerNeutralizacion, exportarProductosCsv, importarCsvPorLotes, leerCsvFilas, neutralizarCelda, simularImportacionCsv,
  type LecturaSinBloqueo, type ProductoExportable,
} from './api.js';
import type { DobleDb } from './doble-db.js';
import { ADM, altaProducto, COMERCIAL_TRES, contar, doc, nuevoEntorno, op, producto, T } from './entorno.js';

let db: DobleDb;
beforeEach(async () => {
  db = await nuevoEntorno();
});

const CAB = 'id,nombre,categoria,sku,precioUSDbo,precioUSDar';
const importar = (csv: string, extra: { omitirErrores?: boolean; lineasOmitidas?: number[]; lectura?: LecturaSinBloqueo; presupuestoMs?: number; ahora?: () => number; base?: Pick<DobleDb, 'runTransaction'> } = {}) =>
  importarCsvPorLotes(extra.base ?? db, { tenantId: T, operacionId: op('imp'), por: ADM, csv, ...extra, ...{ base: undefined } });

describe('omitirErrores exige las líneas que la persona vio', () => {
  const csv = `${CAB}\nbuena,Buena,c,B-1,1,1\nMAL ID,x,c,B-2,1,1\notra,Otra,c,B-3,1,1\n`;

  it('sin lineasOmitidas rechaza (no hay omisión silenciosa) y no escribe', async () => {
    await expect(importar(csv, { omitirErrores: true })).rejects.toThrow(/lineasOmitidas/);
    expect(contar(db, 'productos')).toBe(0);
  });

  it('con las líneas exactas aplica el resto', async () => {
    const r = await importar(csv, { omitirErrores: true, lineasOmitidas: [3] });
    expect(r).toMatchObject({ completa: true, creados: 2, omitidas: 1 });
  });

  it('si una fila se volvió errónea después de la simulación, no escribe nada y devuelve la simulación nueva', async () => {
    await altaProducto(db, producto('otra', { sku: 'B-3' }));
    const antes = contar(db, 'productos');
    // La persona aceptó omitir solo la línea 3; ahora la línea 4 (sku de otro producto: 'otra' existe con ese sku, distinto id) también falla.
    const csv2 = `${CAB}\nbuena,Buena,c,B-1,1,1\nMAL ID,x,c,B-2,1,1\nnueva,Otra,c,B-3,1,1\n`;
    const r = await importar(csv2, { omitirErrores: true, lineasOmitidas: [3] });
    expect(r).toMatchObject({ completa: false, desactualizada: true, creados: 0, lotes: { total: 0, aplicados: 0 } });
    expect(r.detencion).toMatch(/vuelva a simular/);
    expect(r.simulacion.resumen.errores).toBe(2);
    expect(contar(db, 'productos')).toBe(antes);
  });

  it('si una línea aceptada ya no es error también rechaza (el conjunto debe coincidir exactamente)', async () => {
    const r = await importar(`${CAB}\nbuena,Buena,c,B-1,1,1\n`, { omitirErrores: true, lineasOmitidas: [2] });
    expect(r).toMatchObject({ completa: false, desactualizada: true });
    expect(contar(db, 'productos')).toBe(0);
  });
});

describe('simulación sin bloqueo y plazo', () => {
  it('la simulación usa la lectura sin bloqueo (ninguna transacción) y el plazo cuenta desde antes de simular', async () => {
    let transacciones = 0;
    const base = { runTransaction: <R>(f: Parameters<DobleDb['runTransaction']>[0]) => { transacciones += 1; return db.runTransaction(f) as Promise<R>; } };
    let t = 0;
    const lectura: LecturaSinBloqueo = {
      get: (ruta) => {
        t += 1000;
        const d = db.dato(ruta);
        return Promise.resolve({ existe: d !== undefined, data: () => d });
      },
    };
    const r = await importarCsvPorLotes(base, { tenantId: T, operacionId: op('imp'), por: ADM, csv: `${CAB}\na1,A,c,S-1,1,1\n`, lectura, presupuestoMs: 500, ahora: () => t });
    expect(transacciones).toBe(0);
    expect(r).toMatchObject({ completa: false, creados: 0, lotes: { total: 1, aplicados: 0 } });
    expect(r.detencion).toMatch(/tiempo/);
    expect(contar(db, 'productos')).toBe(0);
  });

  it('simularImportacionCsv acepta solo lecturas (sin tx)', async () => {
    const lectura: LecturaSinBloqueo = { get: (ruta) => { const d = db.dato(ruta); return Promise.resolve({ existe: d !== undefined, data: () => d }); } };
    const sim = await simularImportacionCsv(lectura, { tenantId: T, por: ADM, csv: `${CAB}\na1,A,c,S-1,1,1\n` });
    expect(sim.resumen.crear).toBe(1);
  });
});

describe('ida y vuelta de la neutralización', () => {
  it('neutralizar y deshacer son inversas exactas', () => {
    for (const v of ['-x', '+5', '=a', '@b', "'-x", "''=a", "'normal", 'normal', "a'-b"]) expect(deshacerNeutralizacion(neutralizarCelda(v))).toBe(v);
  });

  it('exportar y reimportar sin tocar no cambia nombres, categorías ni marcas que empiezan con - + = @', async () => {
    const nombres = ['-Cable', '+Extra', '=Suma', '@Casa', "'-ya con apóstrofe"];
    for (const [i, n] of nombres.entries()) {
      await altaProducto(db, producto(`pr${String(i)}`, { nombre: n, categoria: `-cat${String(i)}`, marca: `@m${String(i)}` }));
    }
    const filas: ProductoExportable[] = [];
    for (const [i] of nombres.entries()) {
      const p = doc(db, 'productos', `pr${String(i)}`) as Record<string, unknown>;
      filas.push({
        id: `pr${String(i)}`, nombre: p['nombre'] as string, categoria: p['categoria'] as string, marca: p['marca'] as string, sku: p['sku'] as string,
        conSerie: false, precioUSD: { bo: 1000, ar: 1100 }, activo: p['activo'] as boolean, publicado: p['publicado'] as boolean,
      });
    }
    const csv = exportarProductosCsv(filas);
    expect(csv).toContain("'-Cable");
    const sim = await db.runTransaction((tx) => simularImportacionCsv(tx, { tenantId: T, por: ADM, csv }));
    expect(sim.filas.map((f) => f.accion)).toEqual(Array(nombres.length).fill('sin-cambios'));
    const antes = JSON.stringify(db.coleccion(`tenants/${T}/productos`));
    const r = await importar(csv);
    expect(r).toMatchObject({ completa: true, actualizados: 0, sinCambios: nombres.length });
    expect(JSON.stringify(db.coleccion(`tenants/${T}/productos`))).toBe(antes);
  });

  it('una celda con fórmula sin apóstrofe (de una persona) se sigue guardando neutralizada, con aviso', () => {
    const [f] = leerCsvFilas(`${CAB}\nx1,=1+1,c,S-1,1,1\n`, false, COMERCIAL_TRES).filas;
    expect(f?.datos.nombre).toBe("'=1+1");
    expect(f?.advertencias[0]).toMatch(/fórmula/);
  });
});

describe('celdas numéricas de Excel', () => {
  it('redondea al centavo tolerando ruido de coma flotante y rechaza decimales reales', () => {
    const f = leerCsvFilas(`id,nombre,categoria,sku,precioBO,precioAR,costo\na1,A,c,S-1,1234.5599999999999,12.1,0.07\na2,A,c,S-2,12.345,1.005,3\n`, false, COMERCIAL_TRES).filas;
    expect(f[0]?.errores).toEqual([]);
    expect(f[0]?.datos).toMatchObject({ precios: { bo: 123456, ar: 1210 }, costoUSD: 7 });
    expect(f[1]?.errores.map((e) => e.columna)).toEqual(['precioBO', 'precioAR']);
    expect(aEnteroEscalado('0.1', 100)).toBe(10);
    expect(aEnteroEscalado('2,5', 100)).toBe(250);
  });

  it('enteros con .0 se aceptan; con decimales reales no', () => {
    const f = leerCsvFilas('id,nombre,categoria,sku,garantia,minimo\na1,A,c,S-1,3.0,5.0000000000000004\na2,A,c,S-2,3.5,2.5\n', false, COMERCIAL_TRES).filas;
    expect(f[0]?.datos).toMatchObject({ garantiaMeses: 3, minimo: 5 });
    expect(f[1]?.errores.map((e) => e.columna)).toEqual(['garantia', 'minimo']);
  });

  it('un SKU que Excel dejó sin ceros a la izquierda pide formatear la columna como texto', async () => {
    await altaProducto(db, producto('cable', { sku: '00123' }));
    const sim = await db.runTransaction((tx) => simularImportacionCsv(tx, { tenantId: T, por: ADM, csv: `${CAB}\ncable,Cable,general,123,1,1\n` }));
    expect(sim.filas[0]?.accion).toBe('error');
    expect(sim.filas[0]?.errores[0]?.motivo).toMatch(/formatee la columna SKU como texto en Excel/);
  });

  it('un id y un SKU numéricos (12) se toman como texto', () => {
    const [f] = leerCsvFilas('id,nombre,categoria,sku\n12,A,c,34\n', false, COMERCIAL_TRES).filas;
    expect(f).toMatchObject({ id: '12', datos: { sku: '34' } });
    expect(f?.errores).toEqual([]);
  });
});

