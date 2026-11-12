import { beforeEach, describe, expect, it } from 'vitest';
import {
  analizarCsv,
  EntradaInvalida,
  exportarProductosCsv,
  importarProductosCsv,
  neutralizarCelda,
  SinPermiso,
  type Autor,
} from './api.js';
import type { DobleDb } from './doble-db.js';
import { ADM, doc, nuevoEntorno, op, SUP, T, verificarInvariantes } from './entorno.js';

let db: DobleDb;
beforeEach(async () => {
  db = await nuevoEntorno();
});

const importar = (csv: string, cargaInicial = false, por: Autor = ADM, operacionId = op('csv')) =>
  db.runTransaction((tx) => importarProductosCsv(tx, { tenantId: T, operacionId, por, csv, cargaInicial }));

const CAB = 'id,nombre,categoria,sku,precioUSDbo,precioUSDar';

describe('CSV', () => {
  it('analiza comillas, comas y saltos de línea', () => {
    expect(analizarCsv('a,"b,c","d""e"\r\n1,2,3\n')).toEqual([['a', 'b,c', 'd"e'], ['1', '2', '3']]);
    expect(analizarCsv('a,"x\ny"')).toEqual([['a', 'x\ny']]);
    expect(() => analizarCsv('a,"sin cerrar')).toThrow(EntradaInvalida);
  });

  it('neutraliza celdas que empiezan con = + - @', () => {
    for (const c of ['=1+1', '+54', '-2', '@SUMA(A1)', '\tx']) expect(neutralizarCelda(c)).toBe(`'${c}`);
    expect(neutralizarCelda('normal')).toBe('normal');
  });

  it('importa productos sin tocar el stock y neutraliza el texto de fórmulas', async () => {
    const r = await importar(`${CAB}\nlapiz,=HYPERLINK("x"),papeleria,L-1,100,120\ngoma,Goma,papeleria,G-1,50,60\n`);
    expect(r.resultado).toMatchObject({ creados: 2 });
    expect(doc(db, 'productos', 'lapiz')).toMatchObject({ nombre: `'=HYPERLINK("x")`, stockTotal: 0, precioUSD: { bo: 100, ar: 120 } });
    expect(doc(db, 'skus', 'L-1')).toBeDefined();
    verificarInvariantes(db);
  });

  it('el CSV no toca stock: columnas de stock se rechazan salvo en la carga inicial', async () => {
    await expect(importar(`${CAB},stockTienda\nlapiz,Lapiz,p,L-1,1,1,5\n`)).rejects.toThrow(/no toca el stock/);
    await importar(`${CAB},stockTienda,stockDeposito1\nlapiz,Lapiz,p,L-1,1,1,5,3\n`, true);
    expect(doc(db, 'productos', 'lapiz')?.['stockTotal']).toBe(8);
    expect(doc(db, 'existencias', 'lapiz__deposito-1')?.['cantidad']).toBe(3);
    expect(doc(db, 'existencias', 'lapiz__tienda')).toBeDefined();
    verificarInvariantes(db);
  });

  it('todo o nada: una fila inválida rechaza el archivo con el detalle por fila', async () => {
    const error = await importar(`${CAB}\nlapiz,Lapiz,p,L-1,1,1\nMAL ID,x,p,L-2,1,1\ngoma,Goma,p,G-1,-5,1\n`).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EntradaInvalida);
    expect((error as EntradaInvalida).detalles).toHaveLength(2);
    expect(doc(db, 'productos', 'lapiz')).toBeUndefined();
  });

  it('rechaza ids repetidos, fórmulas en id/sku y un archivo sin columna id; las columnas desconocidas se informan y se ignoran', async () => {
    await expect(importar(`${CAB}\na1,x,p,S-1,1,1\na1,y,p,S-2,1,1\n`)).rejects.toThrow(EntradaInvalida);
    await expect(importar(`${CAB}\n=cmd,x,p,S-1,1,1\n`)).rejects.toThrow(EntradaInvalida);
    await expect(importar(`${CAB}\na1,x,p,=S-1,1,1\n`)).rejects.toThrow(EntradaInvalida);
    await expect(importar('nombre,sku\nx,S-1\n')).rejects.toThrow(/falta la columna id/);
    await importar(`${CAB},raro\na1,x,p,S-1,1,1,z\n`);
    expect(doc(db, 'productos', 'a1')).toBeDefined();
    const muchas = Array.from({ length: 1001 }, (_, i) => `p${String(i)}x,n,c,K${String(i)},1,1`).join('\n');
    await expect(importar(`${CAB}\n${muchas}\n`)).rejects.toThrow(/entre 1 y 1000/);
  });

  it('la variante de una sola transacción rechaza lo que no cabe y el tope del plan se respeta', async () => {
    const fila = (i: number) => `q${String(i)}x,n,c,Q${String(i)},1,1`;
    const grande = Array.from({ length: 41 }, (_, i) => fila(i)).join('\n');
    await expect(importar(`${CAB}\n${grande}\n`)).rejects.toThrow(/no cabe en una sola transacción/);
    for (let k = 0; k < 5; k++) await importar(`${CAB}\n${Array.from({ length: 40 }, (_, i) => fila(k * 40 + i)).join('\n')}\n`);
    await expect(importar(`${CAB}\nextra1,n,c,E1,1,1\n`)).rejects.toThrow(/Límite del plan/);
  });

  it('solo adm; con serie no admite stock por CSV', async () => {
    await expect(importar(`${CAB}\na1,x,p,S-1,1,1\n`, false, SUP)).rejects.toBeInstanceOf(SinPermiso);
    const error = await importar(`${CAB},conSerie,stockTienda\na1,x,p,S-1,1,1,true,2\n`, true).catch((e: unknown) => e);
    expect((error as EntradaInvalida).detalles.join(' ')).toMatch(/serie/);
    const mismo = `${CAB}\nidem,x,p,S-7,1,1\n`;
    const a = await importar(mismo, false, ADM, 'csv-1');
    const b = await importar(mismo, false, ADM, 'csv-1');
    expect(a.repetida).toBe(false);
    expect(b.repetida).toBe(true);
  });

  it('exporta neutralizando celdas de texto', () => {
    const csv = exportarProductosCsv([
      { id: 'a1', nombre: '=2+2', categoria: 'x, y', marca: '=Bosch', sku: 'S-1', conSerie: false, precioUSD: { bo: 1, ar: 2 }, activo: true, publicado: false },
      { id: 'a2', nombre: '@cmd', categoria: '-1', sku: 'S-2', conSerie: true, garantiaMeses: 12, precioUSD: { bo: 1, ar: 2 }, activo: true, publicado: true },
    ]);
    expect(csv).toContain(`a1,'=2+2,"x, y",'=Bosch,S-1`);
    expect(csv).toContain(`a2,'@cmd,'-1,,S-2`);
    expect(analizarCsv(csv)).toHaveLength(3);
  });
});
