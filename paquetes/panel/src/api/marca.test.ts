import { describe, expect, it } from 'vitest';
import { conMarca, marcaDe, ponerMarca } from './marca.js';

const conteos = [{ ubicacionId: 'tienda', conteoId: 'c1', abiertoEn: null }] as const;

describe('marca de ocultamiento de una lista', () => {
  it('sin marca: marcaDe es undefined y conMarca no agrega nada', () => {
    const l = [1, 2];
    expect(marcaDe(l)).toBeUndefined();
    expect(marcaDe(undefined)).toBeUndefined();
    expect(Object.getOwnPropertyNames(conMarca([3], l))).not.toContain('existenciasOcultas');
  });

  it('la marca no es enumerable ni sale en JSON y no altera las comparaciones', () => {
    const l = ponerMarca([{ id: 'a' }], { existenciasOcultas: true, conteosAbiertos: conteos });
    expect(l.existenciasOcultas).toBe(true);
    expect(Object.keys(l)).toEqual(['0']);
    expect(JSON.stringify(l)).toBe('[{"id":"a"}]');
    expect(l).toEqual([{ id: 'a' }]);
    expect(l).toStrictEqual([{ id: 'a' }]);
  });

  it('es de solo lectura y no se puede redefinir', () => {
    const l = ponerMarca([1], { existenciasOcultas: true, conteosAbiertos: conteos });
    expect(() => {
      (l as { existenciasOcultas: boolean }).existenciasOcultas = false;
    }).toThrow();
    expect(() => Object.defineProperty(l, 'existenciasOcultas', { value: false })).toThrow();
    expect(l.existenciasOcultas).toBe(true);
  });

  it('filter, map y spread pierden la marca; conMarca la reaplica', () => {
    const origen = ponerMarca([1, 2, 3], { existenciasOcultas: true, conteosAbiertos: conteos });
    expect(marcaDe(origen.filter((n) => n > 1))).toBeUndefined();
    expect(marcaDe([...origen])).toBeUndefined();
    const nueva = conMarca(origen.filter((n) => n > 1), origen);
    expect(nueva).toEqual([2, 3]);
    expect(marcaDe(nueva)).toEqual({ existenciasOcultas: true, conteosAbiertos: conteos });
  });

  it('falla cerrado: oculta sin lista válida queda con lista vacía', () => {
    const l: number[] = [1];
    Object.defineProperty(l, 'existenciasOcultas', { value: true });
    expect(marcaDe(l)).toEqual({ existenciasOcultas: true, conteosAbiertos: [] });
  });
});
