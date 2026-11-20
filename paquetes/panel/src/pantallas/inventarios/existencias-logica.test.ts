import { describe, expect, it } from 'vitest';
import type { ProductoPanel, UbicacionId } from '../../api/tipos.js';
import { almacenOculto, encabezadoAlmacen, filasDeAlmacen } from './existencias-logica.js';

type Ex = Readonly<Record<UbicacionId, number | null>>;
const p = (id: string, nombre: string, existencias: Ex, extra: Partial<ProductoPanel> = {}): ProductoPanel => ({
  id, nombre, categoria: 'c', sku: id.toUpperCase(), activo: true, publicado: true, conSerie: false, precioUSD: {},
  stockTotal: 0, existencias, bajoMinimo: false, disponible: true, ...extra,
});
const ex = (t: number | null, d1: number | null, d2: number | null): Ex => ({ tienda: t, 'deposito-1': d1, 'deposito-2': d2 });

describe('filasDeAlmacen', () => {
  const lista = [p('b', 'Beta', ex(2, 3, 5)), p('a', 'Alfa', ex(1, 0, 4)), p('c', 'Gamma', ex(0, 0, 0))];
  it('suma unidades y productos del almacén, ordenados por nombre', () => {
    const r = filasDeAlmacen(lista, 'deposito-2');
    expect(r).toMatchObject({ oculto: false, unidades: 9, productos: 2 });
    if (!r.oculto) expect(r.filas.map((f) => f.producto.nombre)).toEqual(['Alfa', 'Beta']);
  });
  it('deja fuera los que están en 0, salvo con incluirCero', () => {
    const sin = filasDeAlmacen(lista, 'deposito-1');
    const con = filasDeAlmacen(lista, 'deposito-1', { incluirCero: true });
    expect(sin).toMatchObject({ productos: 1, unidades: 3 });
    expect(con).toMatchObject({ productos: 3, unidades: 3 });
  });
  it('excluye inactivos y los que no controlan stock', () => {
    const l = [p('x', 'Inactivo', ex(9, 9, 9), { activo: false }), p('s', 'Servicio', {} as Ex), p('a', 'Alfa', ex(1, 1, 1))];
    expect(filasDeAlmacen(l, 'tienda')).toMatchObject({ productos: 1, unidades: 1 });
  });
});

describe('almacén oculto', () => {
  it('un solo null en el almacén lo oculta entero, sin filas ni sumas', () => {
    const r = filasDeAlmacen([p('a', 'Alfa', ex(5, 1, 1)), p('b', 'Beta', ex(null, 1, 1))], 'tienda');
    expect(r).toEqual({ oculto: true });
  });
  it('la marca lo nombra aunque la lista no traiga null, o esté vacía', () => {
    expect(filasDeAlmacen([p('a', 'Alfa', ex(5, 1, 1))], 'tienda', { conteos: [{ ubicacionId: 'tienda' }] })).toEqual({ oculto: true });
    expect(filasDeAlmacen([], 'tienda', { conteos: [{ ubicacionId: 'tienda' }] })).toEqual({ oculto: true });
  });
  it('incluirCero no cambia el resultado de un almacén oculto', () => {
    const l = [p('a', 'Alfa', ex(null, 1, 1))];
    expect(filasDeAlmacen(l, 'tienda', { incluirCero: true })).toEqual(filasDeAlmacen(l, 'tienda'));
  });
  it('otro almacén en conteo no oculta el que se consulta', () => {
    const l = [p('a', 'Alfa', ex(null, 4, 0))];
    expect(almacenOculto(l, 'deposito-1', [{ ubicacionId: 'tienda' }])).toBe(false);
    expect(filasDeAlmacen(l, 'deposito-1', { conteos: [{ ubicacionId: 'tienda' }] })).toMatchObject({ oculto: false, unidades: 4 });
  });
  it('un vacío real (sin marca ni null) no es oculto', () => {
    expect(filasDeAlmacen([], 'tienda')).toMatchObject({ oculto: false, productos: 0 });
  });
});

describe('encabezadoAlmacen', () => {
  it('concuerda en singular y plural', () => {
    expect(encabezadoAlmacen('Tienda', 12, 3)).toBe('En Tienda: 12 unidades de 3 productos');
    expect(encabezadoAlmacen('Tienda', 1, 1)).toBe('En Tienda: 1 unidad de 1 producto');
  });
});
