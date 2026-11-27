import { describe, expect, it } from 'vitest';
import { anuncioPortada, escribirPortada, ordenarPortada, totalPortada, visiblesPortada, type ItemPortada } from './portada.js';

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

  it('el orden pone los destacados primero y respeta el del catálogo en cada grupo', () => {
    const base = [
      { id: 'a1', categoria: 'a', destacado: false },
      { id: 'a2', categoria: 'a', destacado: true },
      { id: 'b1', categoria: 'b', destacado: false },
      { id: 'b2', categoria: 'b', destacado: true },
      { id: 'b3', categoria: 'b', destacado: true },
    ];
    const orden = ordenarPortada(base);
    expect(orden.map((i) => i.id)).toEqual(['a2', 'b2', 'b3', 'a1', 'b1']);
    // «Todos» arranca con los destacados y cada categoría, también.
    expect([...visiblesPortada(orden, null, 3)]).toEqual(['a2', 'b2', 'b3']);
    expect([...visiblesPortada(orden, 'b', 3)]).toEqual(['b2', 'b3', 'b1']);
  });
  it('sin destacados se conserva el orden del catálogo', () => {
    const base = lista.map((i) => ({ ...i, destacado: false }));
    expect(ordenarPortada(base)).toEqual(base);
  });
  it('el anuncio dice la categoría y la cuenta en singular o plural', () => {
    expect(anuncioPortada('Televisores', 3)).toBe('Televisores: 3 productos');
    expect(anuncioPortada('Lavadoras', 1)).toBe('Lavadoras: 1 producto');
    expect(anuncioPortada(null, 12)).toBe('Todos: 12 productos');
  });
});
