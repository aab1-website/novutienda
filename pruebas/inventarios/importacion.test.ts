import { beforeEach, describe, expect, it } from 'vitest';
import {
  EntradaInvalida,
  importarCsvPorLotes,
  simularImportacionCsv,
  SinPermiso,
  type Autor,
  type ResultadoImportacion,
  type Simulacion,
} from './api.js';
import type { DobleDb } from './doble-db.js';
import { ADM, altaProducto, contar, doc, nuevoEntorno, op, producto, SUP, T, verificarInvariantes } from './entorno.js';

let db: DobleDb;
beforeEach(async () => {
  db = await nuevoEntorno();
});

const CAB = 'id,nombre,categoria,sku,precioUSDbo,precioUSDar';
const importar = (csv: string, extra: { operacionId?: string; por?: Autor; cargaInicial?: boolean; omitirErrores?: boolean; base?: DobleDb } = {}): Promise<ResultadoImportacion> =>
  importarCsvPorLotes(extra.base ?? db, {
    tenantId: T, operacionId: extra.operacionId ?? op('imp'), por: extra.por ?? ADM, csv,
    ...(extra.cargaInicial !== undefined ? { cargaInicial: extra.cargaInicial } : {}),
    ...(extra.omitirErrores !== undefined ? { omitirErrores: extra.omitirErrores } : {}),
  });
const simular = (csv: string, por: Autor = ADM, cargaInicial = false): Promise<Simulacion> =>
  db.runTransaction((tx) => simularImportacionCsv(tx, { tenantId: T, por, csv, cargaInicial }));
const eventos = () => db.coleccion(`tenants/${T}/eventos`).filter((e) => e.datos['tipo'] === 'producto.cambiado');
const filasNuevas = (n: number, desde = 0): string => Array.from({ length: n }, (_, i) => `p${String(desde + i)}x,Nombre,c,K${String(desde + i)},100,200`).join('\n');

describe('simulación', () => {
  it('no escribe nada ni consume el operacionId; informa crear, actualizar, sin cambios y error con columna y motivo', async () => {
    await altaProducto(db, producto('lapiz', { nombre: 'Lápiz', precioUSD: { bo: 1000, ar: 1100 } }));
    await altaProducto(db, producto('goma'));
    const antes = JSON.stringify(db.coleccion(`tenants/${T}`).map((d) => [d.ruta, d.datos]));
    const sim = await simular(
      `${CAB}\nnuevo,Nuevo,c,N-1,1,2\nlapiz,Lápiz 2,general,SKU-lapiz,1000,1100\ngoma,Producto goma,general,SKU-goma,1000,1100\nMAL ID,x,c,N-2,1,1\nraro,x,c,N-3,abc,1\n`,
    );
    expect(sim.resumen).toEqual({ crear: 1, actualizar: 1, sinCambios: 1, errores: 2 });
    expect(sim.filas.map((f) => f.accion)).toEqual(['crear', 'actualizar', 'sin-cambios', 'error', 'error']);
    expect(sim.filas[1]).toMatchObject({ linea: 3, cambios: ['nombre'] });
    expect(sim.filas[3]?.errores[0]).toMatchObject({ columna: 'id' });
    expect(sim.filas[4]?.errores[0]).toMatchObject({ columna: 'precioUSDbo' });
    expect(JSON.stringify(db.coleccion(`tenants/${T}`).map((d) => [d.ruta, d.datos]))).toBe(antes);
    expect(contar(db, 'operaciones')).toBe(5);
  });

  it('solo adm', async () => {
    await expect(simular(`${CAB}\na1,x,p,S-1,1,1\n`, SUP)).rejects.toBeInstanceOf(SinPermiso);
  });

  it('avisa del tope del plan: las filas que no caben salen como error', async () => {
    await importar(`${CAB}\n${filasNuevas(198)}\n`);
    const sim = await simular(`${CAB}\n${filasNuevas(5, 500)}\n`);
    expect(sim.resumen).toMatchObject({ crear: 2, errores: 3 });
    expect(sim.filas[2]?.errores[0]?.motivo).toMatch(/límite de 200 productos/);
  });

  it('reconoce los dos formatos de columnas y avisa de las ignoradas', async () => {
    const sim = await simular('codigo,nombre,categoria,sku,precio_bo,precioAR,garantia,stock,color\nx1,X,c,S-1,"12,5",3,6,9,rojo\n');
    expect(sim.filas[0]).toMatchObject({ accion: 'crear', errores: [] });
    expect(sim.columnasIgnoradas.join(' ')).toMatch(/stock.*no modifica el stock/);
    expect(sim.columnasIgnoradas).toContain('color');
    await importar('codigo,nombre,categoria,sku,precio_bo,precioAR,garantia\nx1,X,c,S-1,"12,5",3,6\n');
    expect(doc(db, 'productos', 'x1')).toMatchObject({ precioUSD: { bo: 1250, ar: 300 }, garantiaMeses: 6 });
  });
});

describe('importación por lotes', () => {
  it('crea y actualiza; lo que el archivo no trae no cambia; publica un evento por producto creado o editado', async () => {
    await altaProducto(db, producto('lapiz', { marca: 'Faber', minimo: 2 }));
    const antes = eventos().length;
    const r = await importar(`${CAB}\nlapiz,Lápiz nuevo,general,SKU-lapiz,5,6\nnuevo,Nuevo,c,N-1,1,2\n`);
    expect(r).toMatchObject({ completa: true, creados: 1, actualizados: 1, sinCambios: 0, productos: ['lapiz', 'nuevo'] });
    expect(doc(db, 'productos', 'lapiz')).toMatchObject({ nombre: 'Lápiz nuevo', marca: 'Faber', minimo: 2, precioUSD: { bo: 5, ar: 6 } });
    expect(doc(db, 'productos', 'nuevo')).toBeDefined();
    expect(eventos().length - antes).toBe(2);
    expect(doc(db, 'eventos', `pc-${db.coleccion(`tenants/${T}/operaciones`).find((o) => o.datos['tipo'] === 'importar-csv')?.ruta.split('/').pop() ?? ''}__lapiz`)).toBeDefined();
    verificarInvariantes(db);
  });

  it('solo precio publica "precio"; sin cambios no escribe eventos', async () => {
    await altaProducto(db, producto('lapiz'));
    const antes = eventos().length;
    const id = op('imp');
    await importar(`${CAB}\nlapiz,Producto lapiz,general,SKU-lapiz,7,8\n`, { operacionId: id });
    expect(doc(db, 'eventos', `pc-${id}-l1`)).toMatchObject({ datos: { cambio: 'precio' } });
    const r = await importar(`${CAB}\nlapiz,Producto lapiz,general,SKU-lapiz,7,8\n`);
    expect(r).toMatchObject({ creados: 0, actualizados: 0, sinCambios: 1 });
    expect(eventos().length - antes).toBe(1);
  });

  it('el sku no se edita y el stock solo entra en la carga inicial de productos nuevos (en uno existente se ignora con aviso)', async () => {
    await altaProducto(db, producto('lapiz'));
    await expect(importar(`${CAB}\nlapiz,x,general,OTRO,1,1\n`)).rejects.toThrow(/1 fila\(s\) con errores/);
    await expect(importar(`${CAB},stockTienda\nnuevo,N,c,N-1,1,1,5\n`)).rejects.toThrow(/solo se admiten en la carga inicial/);
    const igual = await importar(`${CAB},stockTienda\nlapiz,Producto lapiz,general,SKU-lapiz,1000,1100,5\n`, { cargaInicial: true });
    expect(igual).toMatchObject({ sinCambios: 1 });
    expect(igual.simulacion.filas[0]?.advertencias.join(' ')).toMatch(/stock ignorado/);
    expect(doc(db, 'productos', 'lapiz')?.['stockTotal']).toBe(0);
    await importar(`${CAB},stockTienda,stockDeposito1\nnuevo,N,c,N-1,1,1,5,3\n`, { cargaInicial: true });
    expect(doc(db, 'productos', 'nuevo')?.['stockTotal']).toBe(8);
    expect(db.coleccion(`tenants/${T}/movimientos`).filter((m) => m.datos['productoId'] === 'nuevo')).toHaveLength(2);
    verificarInvariantes(db);
  });

  it('con errores rechaza todo y no escribe; con omitirErrores aplica el resto', async () => {
    const csv = `${CAB}\nbuena,Buena,c,B-1,1,1\nMAL ID,x,c,B-2,1,1\notra,Otra,c,B-3,1,1\n`;
    const error = await importar(csv).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EntradaInvalida);
    expect((error as EntradaInvalida).detalles[0]).toMatch(/línea 3: id:/);
    expect(doc(db, 'productos', 'buena')).toBeUndefined();
    const r = await importar(csv, { omitirErrores: true });
    expect(r).toMatchObject({ completa: true, creados: 2, omitidas: 1 });
  });

  it('respeta el tope de productos del plan', async () => {
    await importar(`${CAB}\n${filasNuevas(198)}\n`);
    await expect(importar(`${CAB}\n${filasNuevas(5, 500)}\n`)).rejects.toThrow(/con errores/);
    const r = await importar(`${CAB}\n${filasNuevas(5, 500)}\n`, { omitirErrores: true });
    expect(r).toMatchObject({ creados: 2, omitidas: 3 });
    expect(contar(db, 'productos')).toBe(200);
  });

  it('reparte en tandas de ≤400 escrituras estimadas (40 filas sin stock) y rechaza más de 1000 filas', async () => {
    await expect(importar(`${CAB}\n${filasNuevas(1001)}\n`)).rejects.toThrow(/entre 1 y 1000/);
    const r = await importar(`${CAB}\n${filasNuevas(190)}\n`);
    expect(r.lotes).toEqual({ total: 5, aplicados: 5 });
    expect(r.creados).toBe(190);
    const conStock = Array.from({ length: 10 }, (_, i) => `s${String(i)}x,N,c,KS${String(i)},1,1,1,1,1`).join('\n');
    const r2 = await importar(`${CAB},stockTienda,stockDeposito1,stockDeposito2\n${conStock}\n`, { cargaInicial: true });
    expect(r2.lotes.total).toBe(1); // peso 22 por fila: 10 filas caben en una tanda
  });

  it('idempotente: repetir con el mismo operacionId no duplica nada y devuelve lo mismo', async () => {
    const id = op('imp');
    const csv = `${CAB}\n${filasNuevas(90)}\n`;
    const a = await importar(csv, { operacionId: id });
    const eventosA = eventos().length;
    const b = await importar(csv, { operacionId: id });
    expect(b).toMatchObject({ completa: true, creados: a.creados, lotes: a.lotes });
    expect(eventos().length).toBe(eventosA);
    expect(contar(db, 'productos')).toBe(90);
  });

  it('un fallo a mitad deja las tandas anteriores aplicadas, nada de la fallida, y el reintento continúa', async () => {
    const id = op('imp');
    const csv = `${CAB}\n${filasNuevas(90)}\n`; // tandas de 40, 40 y 10 filas
    // Entre la simulación y la tanda 2 alguien ocupa el sku K50 (fila de la tanda 2).
    let llamadas = 0;
    const saboteador: DobleDb = Object.create(db) as DobleDb;
    saboteador.runTransaction = (async <R>(f: Parameters<DobleDb['runTransaction']>[0]) => {
      llamadas += 1;
      if (llamadas === 3) db.poner(`tenants/${T}/skus/K50`, { productoId: 'ajeno' });
      return db.runTransaction(f as never) as Promise<R>;
    }) as DobleDb['runTransaction'];
    const parcial = await importar(csv, { operacionId: id, base: saboteador });
    expect(parcial).toMatchObject({ completa: false, creados: 40, lotes: { total: 3, aplicados: 1 } });
    expect(parcial.detencion).toMatch(/Tanda 2 de 3.*sku/);
    expect(contar(db, 'productos')).toBe(40);
    expect(doc(db, 'productos', 'p40x')).toBeUndefined();
    db.poner(`tenants/${T}/skus/K50`, undefined);
    const final = await importar(csv, { operacionId: id });
    expect(final).toMatchObject({ completa: true, creados: 90, lotes: { total: 3, aplicados: 3 } });
    expect(contar(db, 'productos')).toBe(90);
    verificarInvariantes(db);
  });

  it('solo adm', async () => {
    await expect(importar(`${CAB}\na1,x,p,S-1,1,1\n`, { por: SUP })).rejects.toBeInstanceOf(SinPermiso);
  });
});
