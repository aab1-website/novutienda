import { beforeEach, describe, expect, it } from 'vitest';
import { actualizarProducto, EntradaInvalida, importarCsvPorLotes, leerCsvFilas, simularImportacionCsv } from './api.js';
import type { DobleDb } from './doble-db.js';
import { ADM, altaProducto, COMERCIAL_TRES, nuevoEntorno, op, producto, T } from './entorno.js';

let db: DobleDb;
beforeEach(async () => {
  db = await nuevoEntorno();
});

const TOPE = 100_000_000;
const sinCatalogo = async (): Promise<[]> => [];
const editar = (cambios: Parameters<typeof actualizarProducto>[1]['cambios'], productoId = 'lapiz') =>
  db.runTransaction((tx) => actualizarProducto(tx, { tenantId: T, operacionId: op('ed'), por: ADM, productoId, cambios }));
const simular = (csv: string) => db.runTransaction((tx) => simularImportacionCsv(tx, { catalogo: sinCatalogo, tenantId: T, por: ADM, csv }));

describe('tope de precio y costo (D1 estricto)', () => {
  it('el tope justo se guarda y un centavo más se rechaza con el mensaje del mercado', async () => {
    await altaProducto(db, producto('justo', { precioUSD: { bo: TOPE, ar: 1 }, costoUSD: TOPE }));
    await expect(altaProducto(db, producto('alto', { precioUSD: { bo: 1, ar: TOPE + 1 } }))).rejects.toThrow(
      'El precio de Argentina va en USD (moneda base) y supera el tope de 1.000.000: ¿lo cargó en pesos argentinos?',
    );
  });

  it('el costo sobre el tope se rechaza al crear y al editar, con su moneda', async () => {
    await expect(altaProducto(db, producto('c1', { costoUSD: TOPE + 1 }))).rejects.toThrow('El costo va en USD y supera el tope de 1.000.000');
    await altaProducto(db, producto('lapiz'));
    await expect(editar({ costoUSD: TOPE + 1 })).rejects.toThrow(/El costo va en USD y supera el tope/);
    await editar({ costoUSD: TOPE });
  });

  it('al editar, un precio guardado que ya excede el tope obliga a corregirlo', async () => {
    await altaProducto(db, producto('lapiz'));
    db.poner(`tenants/${T}/productos/lapiz`, { ...(db.dato(`tenants/${T}/productos/lapiz`) ?? {}), precioUSD: { bo: TOPE * 5, ar: 1 } });
    await expect(editar({ precioUSD: { bo: TOPE * 5, ar: 2 } })).rejects.toThrow(/El precio de Bolivia/);
    await editar({ precioUSD: { bo: 10, ar: 2 } });
  });

  it('editar solo el nombre con precio o costo guardado sobre el tope falla', async () => {
    await altaProducto(db, producto('lapiz'));
    db.poner(`tenants/${T}/productos/lapiz`, { ...(db.dato(`tenants/${T}/productos/lapiz`) ?? {}), precioUSD: { bo: TOPE * 5, ar: 1 } });
    await expect(editar({ nombre: 'Otro' })).rejects.toThrow(/El precio guardado de Bolivia no cumple: .* Corríjalo antes de guardar\./);
    db.poner(`tenants/${T}/productos/lapiz`, { ...(db.dato(`tenants/${T}/productos/lapiz`) ?? {}), precioUSD: { bo: 10, ar: 1 } });
    db.poner(`tenants/${T}/costos/lapiz`, { costoUSD: TOPE * 5 });
    await expect(editar({ nombre: 'Otro' })).rejects.toThrow(/El costo guardado no cumple: El costo va en USD/);
  });

  it('editar solo el nombre de un producto guardado con «Audio» falla', async () => {
    await altaProducto(db, producto('lapiz'));
    db.poner(`tenants/${T}/productos/lapiz`, { ...(db.dato(`tenants/${T}/productos/lapiz`) ?? {}), categoria: 'Audio' });
    await expect(editar({ nombre: 'Otro' })).rejects.toThrow('La categoría guardada «Audio» no cumple: La categoría va en minúsculas, sin tildes ni espacios: use «audio». Corríjalo antes de guardar.');
  });
});

describe('categoría con forma de slug', () => {
  it('se rechaza «Audio» con la sugerencia, al crear y al editar', async () => {
    await expect(altaProducto(db, producto('a1', { categoria: 'Audio' }))).rejects.toThrow('La categoría va en minúsculas, sin tildes ni espacios: use «audio».');
    await altaProducto(db, producto('lapiz'));
    await expect(editar({ categoria: 'Línea Blanca' })).rejects.toThrow('use «linea-blanca»');
    await expect(editar({ categoria: 'Audio' })).rejects.toBeInstanceOf(EntradaInvalida);
    await editar({ categoria: 'linea-blanca' });
  });
});

describe('importación: tope y categoría por celda', () => {
  const CAB = 'nombre,categoria,sku,precioBO,precioAR,costo';
  it('marca la celda de categoría, de precio y de costo', () => {
    const [f] = leerCsvFilas(`${CAB}\nA,Electrodomésticos,S-1,1000001,1,1000001\n`, false, COMERCIAL_TRES).filas;
    expect(f?.errores).toEqual([
      { columna: 'categoria', motivo: 'La categoría va en minúsculas, sin tildes ni espacios: use «electrodomesticos».' },
      { columna: 'precioBO', motivo: 'El precio de Bolivia va en USD (moneda base) y supera el tope de 1.000.000: ¿lo cargó en bolivianos?' },
      { columna: 'costo', motivo: 'El costo va en USD y supera el tope de 1.000.000: revise que no tenga ceros de más ni esté en otra moneda.' },
    ]);
  });

  it('el tope justo pasa', () => {
    const [f] = leerCsvFilas(`${CAB}\nA,audio,S-1,1000000,1000000.00,1000000\n`, false, COMERCIAL_TRES).filas;
    expect(f?.errores).toEqual([]);
  });

  it('un precio guardado sobre el tope que se reenvía al cambiar otro precio es error de fila', async () => {
    await altaProducto(db, producto('lapiz'));
    db.poner(`tenants/${T}/productos/lapiz`, { ...(db.dato(`tenants/${T}/productos/lapiz`) ?? {}), precioUSD: { bo: TOPE * 5, ar: 1 } });
    const sim = await simular('sku,precioAR\nSKU-lapiz,5\n');
    expect(sim.filas[0]?.accion).toBe('error');
    expect(sim.filas[0]?.errores[0]?.columna).toBe('precioBO');
    expect(sim.filas[0]?.errores[0]?.motivo).toMatch(/precio guardado de Bolivia/);
  });

  it('desproporción entre mercados: advertencia que no bloquea', async () => {
    const sim = await simular('nombre,categoria,sku,precioBO,precioAR\nA,audio,S-1,1.00,50.00\n');
    expect(sim.filas[0]?.accion).toBe('crear');
    expect(sim.filas[0]?.advertencias.some((a) => /más de 10 veces/.test(a))).toBe(true);
    const r = await importarCsvPorLotes(db, { catalogo: sinCatalogo, tenantId: T, operacionId: op('imp'), por: ADM, csv: 'nombre,categoria,sku,precioBO,precioAR\nA,audio,S-1,1.00,50.00\n' });
    expect(r.completa).toBe(true);
  });

  it('una fila que solo cambia el nombre falla con la columna si el precio o el costo guardado exceden el tope', async () => {
    await altaProducto(db, producto('lapiz'));
    db.poner(`tenants/${T}/productos/lapiz`, { ...(db.dato(`tenants/${T}/productos/lapiz`) ?? {}), precioUSD: { bo: TOPE * 5, ar: 1 } });
    let sim = await simular('sku,nombre\nSKU-lapiz,Otro nombre\n');
    expect(sim.filas[0]?.accion).toBe('error');
    expect(sim.filas[0]?.errores[0]?.columna).toBe('precioBO');
    expect(sim.filas[0]?.errores[0]?.motivo).toMatch(/^El precio guardado de Bolivia no cumple:/);
    db.poner(`tenants/${T}/productos/lapiz`, { ...(db.dato(`tenants/${T}/productos/lapiz`) ?? {}), precioUSD: { bo: 10, ar: 1 } });
    db.poner(`tenants/${T}/costos/lapiz`, { costoUSD: TOPE * 5 });
    sim = await simular('sku,nombre\nSKU-lapiz,Otro nombre\n');
    expect(sim.filas[0]?.accion).toBe('error');
    expect(sim.filas[0]?.errores[0]?.columna).toBe('costo');
    expect(sim.filas[0]?.errores[0]?.motivo).toMatch(/^El costo guardado no cumple:/);
  });
});
