import { describe, expect, it } from 'vitest';
import { contarFiltros, limitesDePrecio, refinar, SIN_FILTROS } from './refinar.js';
import { enVenta, unificarMarcas } from '../contenido/consultas.js';

const item = (nombre: string, marca: string, precio: number | null) => ({ nombre, marca, categoria: 'Cat', precio });
const lista = [item('Televisor 55', 'Aurora', 5000), item('Televisor 65', 'Aurora', 9000), item('Lavadora 9 kg', 'Nórdika', 3000), item('Parlante', 'Nórdika', null)];
const precioDe = (x: { precio: number | null }): number | null => x.precio;

describe('refinar', () => {
  it('sin filtros devuelve todo, en orden', () => {
    expect(refinar(lista, SIN_FILTROS, precioDe)).toHaveLength(4);
  });
  it('filtra por texto, marca y precio sobre toda la lista', () => {
    expect(refinar(lista, { ...SIN_FILTROS, texto: 'televisor' }, precioDe).map((x) => x.nombre)).toEqual(['Televisor 55', 'Televisor 65']);
    expect(refinar(lista, { ...SIN_FILTROS, marcas: ['Nórdika'] }, precioDe)).toHaveLength(2);
    expect(refinar(lista, { ...SIN_FILTROS, rango: [4000, 9000] }, precioDe).map((x) => x.nombre)).toEqual(['Televisor 55', 'Televisor 65']);
    expect(refinar(lista, { texto: 'nordika', marcas: ['Nórdika'], rango: [0, 4000] }, precioDe).map((x) => x.nombre)).toEqual(['Lavadora 9 kg']);
  });
  it('con precio activo los productos a consultar se ocultan', () => {
    expect(refinar(lista, { ...SIN_FILTROS, rango: [0, 99999] }, precioDe).map((x) => x.nombre)).not.toContain('Parlante');
  });
  it('cuenta los filtros activos', () => {
    expect(contarFiltros(SIN_FILTROS)).toBe(0);
    expect(contarFiltros({ texto: ' a ', marcas: ['x', 'y'], rango: [1, 2] })).toBe(4);
  });
});

describe('limitesDePrecio', () => {
  it('toma los precios reales y ajusta al paso', () => {
    expect(limitesDePrecio([3000, 5000, 9000, null])).toEqual({ min: 3000, max: 9000, paso: 100 });
  });
  it('sin rango real no hay deslizante', () => {
    expect(limitesDePrecio([])).toBeNull();
    expect(limitesDePrecio([null, 0])).toBeNull();
    expect(limitesDePrecio([500, 500])).toBeNull();
  });
});

describe('productos sin stock y marcas repetidas', () => {
  it('enVenta deja solo los disponibles', () => {
    expect(enVenta([{ disponible: true, n: 1 }, { disponible: false, n: 2 }])).toEqual([{ disponible: true, n: 1 }]);
  });
  it('unifica «samsung», «Samsung» y «SAMSUNG» en un solo nombre, el más usado', () => {
    const r = unificarMarcas([{ marca: 'samsung' }, { marca: 'Samsung' }, { marca: 'Samsung' }, { marca: 'LG' }]);
    expect(r.map((p) => p.marca)).toEqual(['Samsung', 'Samsung', 'Samsung', 'LG']);
  });
  it('en empate prefiere la que trae mayúscula', () => {
    expect(unificarMarcas([{ marca: 'samsung' }, { marca: 'Samsung' }]).map((p) => p.marca)).toEqual(['Samsung', 'Samsung']);
  });
});
