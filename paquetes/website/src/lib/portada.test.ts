import { describe, expect, it } from 'vitest';
import { escribirPortada, totalPortada, visiblesPortada, type ItemPortada } from './portada.js';

const items = (n: number, cat: (i: number) => string): ItemPortada[] => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, categoria: cat(i) }));

describe('portada: filtro por categoría', () => {
  const lista = items(10, (i) => (i % 2 === 0 ? 'a' : 'b'));
  it('«Todos» muestra las primeras tarjetas en el orden del catálogo', () => {
    expect([...visiblesPortada(lista, null, 3)]).toEqual(['p0', 'p1', 'p2']);
  });
  it('una categoría muestra solo sus productos, en su orden', () => {
    expect([...visiblesPortada(lista, 'b', 3)]).toEqual(['p1', 'p3', 'p5']);
  });
  it('una categoría sin productos no muestra nada', () => {
    expect(visiblesPortada(lista, 'z').size).toBe(0);
  });
  it('el total cuenta la selección completa, no solo lo visible', () => {
    expect(totalPortada(lista, null)).toBe(10);
    expect(totalPortada(lista, 'a')).toBe(5);
  });
  it('lo que se escribe en el HTML incluye el tope de «Todos» y el de cada categoría, sin repetir ni reordenar', () => {
    const grande = items(40, (i) => (i < 30 ? 'a' : 'b'));
    const escritos = escribirPortada(grande, 4).map((i) => i.id);
    expect(escritos).toEqual(['p0', 'p1', 'p2', 'p3', 'p30', 'p31', 'p32', 'p33']);
    expect(new Set(escritos).size).toBe(escritos.length);
  });
  it('con pocos productos se escriben todos', () => {
    expect(escribirPortada(lista, 12)).toEqual(lista);
  });
});
