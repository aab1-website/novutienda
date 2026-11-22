import { describe, expect, it } from 'vitest';
import { relacionados } from './relacionados.js';
import { contenidoEjemplo } from '../contenido/ejemplo.js';
import type { Producto } from '../contenido/tipos.js';

const base = contenidoEjemplo.productos[0] as Producto;
const prod = (id: string, categoria: string): Producto => ({ ...base, id, categoria });

describe('relacionados', () => {
  it('toma la misma categoría, sin el propio', () => {
    const ps = [prod('a', 'x'), prod('b', 'x'), prod('c', 'y'), prod('d', 'x')];
    expect(relacionados(ps, ps[0]!).map((p) => p.id)).toEqual(['b', 'd']);
  });
  it('llega a 4 como máximo', () => {
    const ps = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => prod(id, 'x'));
    expect(relacionados(ps, ps[0]!)).toHaveLength(4);
  });
  it('sin otros de su categoría no hay relacionados', () => {
    const ps = [prod('a', 'x'), prod('c', 'y')];
    expect(relacionados(ps, ps[0]!)).toEqual([]);
  });
});
