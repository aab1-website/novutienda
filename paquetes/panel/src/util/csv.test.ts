import { describe, expect, it } from 'vitest';
import { aCsv } from './csv.js';

describe('aCsv', () => {
  it('por defecto separa con coma y entrecomilla las celdas con coma', () => {
    expect(aCsv(['a', 'b'], [['x,y', 1]])).toBe('a,b\r\n"x,y",1\r\n');
  });

  it('con separador punto y coma, la coma no se entrecomilla y el separador sí', () => {
    expect(aCsv(['a', 'b'], [['x,y', 'p;q']], { separador: ';' })).toBe('a;b\r\nx,y;"p;q"\r\n');
  });
});
