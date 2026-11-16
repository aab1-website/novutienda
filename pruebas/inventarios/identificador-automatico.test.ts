import { beforeEach, describe, expect, it } from 'vitest';
import {
  esProductoId,
  exportarProductosCsv,
  identificadorParaAlta,
  importarCsvPorLotes,
  simularImportacionCsv,
  type Autor,
  type ResultadoImportacion,
  type Simulacion,
} from './api.js';
import type { DobleDb } from './doble-db.js';
import { ADM, altaProducto, COMERCIAL_TRES, doc, nuevoEntorno, op, producto, T } from './entorno.js';

let db: DobleDb;
beforeEach(async () => {
  db = await nuevoEntorno();
});

const importar = (csv: string, operacionId = op('imp'), por: Autor = ADM): Promise<ResultadoImportacion> =>
  importarCsvPorLotes(db, { tenantId: T, operacionId, por, csv });
const simular = (csv: string): Promise<Simulacion> => db.runTransaction((tx) => simularImportacionCsv(tx, { tenantId: T, por: ADM, csv }));
const ids = (): string[] => db.coleccion(`tenants/${T}/productos`).map((d) => d.ruta.split('/').pop() ?? '').sort();
const SIN_ID = 'nombre,categoria,sku,precioUSDbo,precioUSDar';

/** Vectores compartidos con el panel (`producto-revision.test.ts`): deben coincidir letra por letra. */
export const VECTORES: readonly { nombre: string; sku: string; ocupados: string[]; id: string }[] = [
  { nombre: 'Cable HDMI 2 m', sku: 'C-1', ocupados: [], id: 'cable-hdmi-2-m' },
  { nombre: '  Audífonos  inalámbricos! ', sku: 'A-1', ocupados: [], id: 'audifonos-inalambricos' },
  { nombre: 'Cable HDMI', sku: 'C-2', ocupados: ['cable-hdmi'], id: 'cable-hdmi-2' },
  { nombre: 'Cable HDMI', sku: 'C-2', ocupados: ['cable-hdmi', 'cable-hdmi-2'], id: 'cable-hdmi-3' },
  { nombre: '!!', sku: 'AB-12', ocupados: [], id: 'ab-12' },
  { nombre: 'a', sku: 'Z9', ocupados: [], id: 'z9' },
  { nombre: '!!', sku: '#', ocupados: [], id: 'producto' },
  { nombre: '!!', sku: '#', ocupados: ['producto'], id: 'producto-2' },
  { nombre: 'a'.repeat(100), sku: 'X-1', ocupados: [], id: 'a'.repeat(56) },
  { nombre: 'Ñandú', sku: 'N-1', ocupados: [], id: 'nandu' },
];

describe('identificadorParaAlta', () => {
  it.each(VECTORES)('vector %#', (v) => {
    const id = identificadorParaAlta(v.nombre, v.sku, new Set(v.ocupados));
    expect(id).toBe(v.id);
    expect(esProductoId(id)).toBe(true);
  });
  it('siempre produce un id válido, también con el sufijo más largo', () => {
    const base = 'a'.repeat(56);
    const ocupados = new Set([base, ...Array.from({ length: 997 }, (_, i) => `${base}-${String(i + 2)}`.slice(0, 60))]);
    const id = identificadorParaAlta(base, 'S-1', ocupados);
    expect(id).toBe(`${base}-999`);
    expect(esProductoId(id)).toBe(true);
  });
});

describe('importación sin columna id', () => {
  it('crea por SKU con un id generado y actualiza lo que ya tiene ese SKU', async () => {
    const r = await importar(`${SIN_ID}\nTaladro Bosch,herr,TAL-1,100,200\n`);
    expect(r).toMatchObject({ completa: true, creados: 1, actualizados: 0 });
    expect(doc(db, 'productos', 'taladro-bosch')).toMatchObject({ sku: 'TAL-1' });
    const r2 = await importar(`${SIN_ID}\nTaladro Bosch 2,herr,TAL-1,100,200\n`);
    expect(r2).toMatchObject({ creados: 0, actualizados: 1 });
    expect(doc(db, 'productos', 'taladro-bosch')).toMatchObject({ nombre: 'Taladro Bosch 2' });
    expect(ids()).toEqual(['taladro-bosch']);
  });

  it('dos filas con el mismo nombre reciben claves distintas, también contra lo existente', async () => {
    await altaProducto(db, producto('lapiz'));
    await importar(`${SIN_ID}\nLapiz,c,L-1,1,1\nLapiz,c,L-2,1,1\n`);
    expect(ids()).toEqual(['lapiz', 'lapiz-2', 'lapiz-3']);
  });

  it('una fila sin id exige sku', async () => {
    await expect(importar('nombre,categoria,sku\nX1,c,\n')).rejects.toThrow(/fila\(s\) con errores/);
    const sim = await simular('nombre,categoria,sku\nX1,c,\n');
    expect(sim.filas[0]?.errores[0]).toMatchObject({ columna: 'sku' });
  });

  it('id y sku de productos distintos: error claro con el nombre del otro', async () => {
    await altaProducto(db, producto('uno'));
    await altaProducto(db, producto('dos'));
    const sim = await simular('id,nombre,categoria,sku\nuno,Uno,c,SKU-dos\n');
    expect(sim.filas[0]?.accion).toBe('error');
    expect(sim.filas[0]?.errores[0]?.motivo).toBe('el SKU pertenece a otro producto (Producto dos)');
  });

  it('`codigo` es el SKU', async () => {
    await importar('codigo,nombre,categoria,precioUSDbo,precioUSDar\nK-77,Parlante,c,1,1\n');
    expect(doc(db, 'productos', 'parlante')).toMatchObject({ sku: 'K-77' });
    await expect(importar('codigo,sku,nombre,categoria\nK-1,K-2,P,c\n')).rejects.toThrow(/columna repetida/);
  });

  it('una planilla vieja con id se comporta como siempre', async () => {
    const r = await importar('id,nombre,categoria,sku,precioUSDbo,precioUSDar\nviejo-1,Viejo,c,V-1,1,1\n');
    expect(r.productos).toEqual(['viejo-1']);
    expect(doc(db, 'productos', 'viejo-1')).toBeDefined();
  });

  it('la clave explícita de otra fila no la toma una generada', async () => {
    await importar('id,nombre,categoria,sku\nlapiz,Otro,c,O-1\n');
    const antes = ids();
    expect(antes).toEqual(['lapiz']);
    await importar(`${SIN_ID}\nLapiz,c,L-1,1,1\n`);
    expect(ids()).toEqual(['lapiz', 'lapiz-2']);
  });

  it('exportar y volver a importar no cambia nada', async () => {
    await altaProducto(db, producto('taladro', { nombre: 'Taladro', sku: 'TAL-1' }));
    await altaProducto(db, producto('sierra', { nombre: 'Sierra', sku: 'SIE-1' }));
    const csv = exportarProductosCsv(
      ['taladro', 'sierra'].map((id) => ({ id, nombre: id === 'taladro' ? 'Taladro' : 'Sierra', categoria: 'general', sku: id === 'taladro' ? 'TAL-1' : 'SIE-1', conSerie: false, precioUSD: { bo: 1000, ar: 1100 }, activo: true, publicado: false })),
      COMERCIAL_TRES,
    );
    expect(csv.split('\r\n')[0]).not.toMatch(/(^|,)id(,|$)/);
    const sim = await simular(csv);
    expect(sim.resumen).toEqual({ crear: 0, actualizar: 0, sinCambios: 2, errores: 0 });
    expect(sim.filas[0]).toMatchObject({ nombre: 'Taladro', sku: 'TAL-1' });
  });

  it('un reintento tras un corte reconoce por SKU lo ya creado y no duplica', async () => {
    const csv = `${SIN_ID}\nUno,c,U-1,1,1\nDos,c,D-1,1,1\n`;
    await importar(csv, 'misma');
    await importar(csv, 'misma');
    expect(ids()).toEqual(['dos', 'uno']);
    // Otro operacionId, mismo archivo: tampoco duplica, porque reconoce los SKU.
    const r = await importar(csv, 'otra');
    expect(r.creados).toBe(0);
    expect(ids()).toEqual(['dos', 'uno']);
  });
});

describe('SKU que solo difiere en mayúsculas', () => {
  it('se permite pero se avisa, contra otra fila y contra un producto existente', async () => {
    const sim = await simular(`${SIN_ID}\nA,c,abc-1,1,1\nB,c,ABC-1,1,1\n`);
    expect(sim.resumen.errores).toBe(0);
    expect(sim.filas.every((f) => f.advertencias.some((a) => /Se parece al SKU de otro producto/.test(a)))).toBe(true);
    await altaProducto(db, producto('x1', { sku: 'ABC-9' }));
    const s2 = await simular(`${SIN_ID}\nNuevo,c,abc-9,1,1\n`);
    expect(s2.filas[0]).toMatchObject({ accion: 'crear' });
    expect(s2.filas[0]?.advertencias.join(' ')).toMatch(/Se parece al SKU de otro producto/);
  });
});
