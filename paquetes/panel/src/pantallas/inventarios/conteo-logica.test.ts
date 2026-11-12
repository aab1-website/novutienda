import { describe, expect, it } from 'vitest';
import type { ProductoDeConteo } from '../../api/tipos.js';
import { avance, contarPendientes, lineasDeCierre, normalizarTexto, revisarTexto, textoGuardado } from './conteo-logica.js';

const p = (id: string, conSerie = false): ProductoDeConteo => ({ productoId: id, nombre: id, categoria: 'c', sku: id, conSerie });

describe('revisarTexto', () => {
  it('pide un entero de 0 o más', () => {
    expect(revisarTexto(p('a'), '')).toMatch(/entero/);
    expect(revisarTexto(p('a'), '-1')).toMatch(/entero/);
    expect(revisarTexto(p('a'), '2,5')).toMatch(/entero/);
    expect(revisarTexto(p('a'), '0')).toBeNull();
    expect(revisarTexto(p('a'), ' 12 ')).toBeNull();
  });
  it('en productos con serie pide series sin repetir', () => {
    expect(revisarTexto(p('a', true), ' ')).toMatch(/serie/);
    expect(revisarTexto(p('a', true), 'S1, S1')).toMatch(/repetidas/);
    expect(revisarTexto(p('a', true), 'S1, S2')).toBeNull();
  });
});

describe('comparación con lo guardado', () => {
  it('«020» y «20» son lo mismo; las series se comparan sin importar separadores', () => {
    expect(normalizarTexto(p('a'), '020')).toBe(normalizarTexto(p('a'), '20'));
    expect(normalizarTexto(p('a', true), 'S1,S2')).toBe(normalizarTexto(p('a', true), 'S1  S2'));
    expect(textoGuardado(p('a'), { productoId: 'a', contado: 7 })).toBe('7');
    expect(textoGuardado(p('a', true), { productoId: 'a', contado: 2, series: ['S1', 'S2'] })).toBe('S1 S2');
    expect(textoGuardado(p('a'), undefined)).toBe('');
  });
  it('cuenta pendientes solo donde lo escrito difiere de lo registrado', () => {
    const lista = [p('a'), p('b'), p('c')];
    const lineas = [{ productoId: 'a', contado: 4 }];
    expect(contarPendientes(lista, { a: '4', b: '', c: '3' }, lineas)).toBe(1);
    expect(contarPendientes(lista, { a: '5' }, lineas)).toBe(1);
    expect(contarPendientes(lista, {}, lineas)).toBe(0);
  });
});

describe('avance y cierre', () => {
  it('«18 de 41»', () => {
    const lista = Array.from({ length: 41 }, (_, i) => p(`p${String(i)}`));
    const lineas = lista.slice(0, 18).map((x) => ({ productoId: x.productoId, contado: 1 }));
    expect(avance(lista, lineas).texto).toBe('18 de 41');
  });
  it('el cierre calcula en el panel cuántos faltan y no afirma cuántas mermas habrá', () => {
    const t = lineasDeCierre({ contados: 18, total: 41 }).join(' ');
    expect(t).toContain('Faltan 23 productos por contar. Los que tengan existencias en el sistema se contarán en 0 y generarán mermas.');
    expect(lineasDeCierre({ contados: 1, total: 2 }).join(' ')).toContain('Faltan 1 producto por contar.');
    expect(lineasDeCierre({ contados: 2, total: 2 }).join(' ')).not.toMatch(/Faltan|se contarán en 0/);
    expect(lineasDeCierre({ contados: 2, total: 2 }).join(' ')).toContain('No falta ningún producto por contar.');
  });
});
