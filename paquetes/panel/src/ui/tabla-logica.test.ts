import { describe, expect, it } from 'vitest';
import { filtrar, ordenar, paginar } from './tabla-logica.js';

interface Fila { n: string; rol: string; k: number }
const filas: Fila[] = [
  { n: 'José Pérez', rol: 'caj', k: 10 },
  { n: 'Ana Gómez', rol: 'sup', k: 2 },
  { n: 'jose luis', rol: 'caj', k: 2 },
];
const en = (f: Fila): string[] => [f.n];

describe('filtrar', () => {
  it('busca sin tildes ni mayúsculas y exige todas las palabras', () => {
    expect(filtrar(filas, 'JOSE', en, [], {}).map((f) => f.n)).toEqual(['José Pérez', 'jose luis']);
    expect(filtrar(filas, 'perez jose', en, [], {})).toHaveLength(1);
    expect(filtrar(filas, '  ', en, [], {})).toHaveLength(3);
  });
  it('aplica filtros solo con valor elegido', () => {
    const f = [{ id: 'rol', aplica: (x: Fila, v: string) => x.rol === v }];
    expect(filtrar(filas, '', en, f, { rol: 'sup' })).toHaveLength(1);
    expect(filtrar(filas, '', en, f, { rol: '' })).toHaveLength(3);
    expect(filtrar(filas, 'jose', en, f, { rol: 'caj' })).toHaveLength(2);
  });
});

describe('ordenar', () => {
  it('ordena números y textos, es estable y no muta', () => {
    expect(ordenar(filas, (f) => f.k, { columna: 'k', sentido: 'asc' }).map((f) => f.n)).toEqual(['Ana Gómez', 'jose luis', 'José Pérez']);
    expect(ordenar(filas, (f) => f.k, { columna: 'k', sentido: 'desc' })[0]?.n).toBe('José Pérez');
    expect(ordenar(filas, (f) => f.n, { columna: 'n', sentido: 'asc' })[0]?.n).toBe('Ana Gómez');
    expect(filas[0]?.n).toBe('José Pérez');
  });
  it('sin orden devuelve una copia en el orden original', () => {
    expect(ordenar(filas, undefined, null)).toEqual(filas);
  });
});

describe('paginar', () => {
  const cien = Array.from({ length: 100 }, (_, i) => i);
  it('corta la página y calcula el rango', () => {
    const p = paginar(cien, 2, 25);
    expect(p).toMatchObject({ pagina: 2, paginas: 4, desde: 26, hasta: 50, total: 100 });
    expect(p.filas[0]).toBe(25);
  });
  it('acota páginas fuera de rango y maneja vacío y última parcial', () => {
    expect(paginar(cien, 99, 25).pagina).toBe(4);
    expect(paginar(cien, 0, 25).pagina).toBe(1);
    expect(paginar([], 1, 25)).toMatchObject({ desde: 0, hasta: 0, paginas: 1, total: 0 });
    expect(paginar(cien.slice(0, 30), 2, 25)).toMatchObject({ desde: 26, hasta: 30 });
  });
});
