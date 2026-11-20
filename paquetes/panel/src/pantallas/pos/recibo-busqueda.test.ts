import { describe, expect, it } from 'vitest';
import { filtrar } from '../../ui/tabla-logica.js';
import { aliasRecibo, numeroDeRecibo } from './recibo-busqueda.js';

const ventas = [{ serie: 'A', n: 4 }, { serie: 'A', n: 14 }, { serie: 'A', n: 5 }];
const buscar = (t: string): number[] => filtrar(ventas, t, (v) => aliasRecibo(v.serie, v.n), [], {}).map((v) => v.n);

describe('búsqueda de recibos', () => {
  it('el número impreso lleva seis dígitos', () => expect(numeroDeRecibo('A', 4)).toBe('A-000004'));
  it('«A4», «a-4» y «4» encuentran A-000004', () => {
    expect(buscar('A4')).toEqual([4]);
    expect(buscar('a-4')).toEqual([4]);
    expect(buscar('4')).toEqual([4, 14]);
    expect(buscar('A-000004')).toEqual([4]);
  });
});
