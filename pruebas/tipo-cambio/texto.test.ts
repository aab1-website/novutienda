import { describe, expect, it } from 'vitest';
import { diasHabilesEntre, filasDe, plano } from './nucleo-tc.js';

/** Corre `f` y devuelve los milisegundos que tardó. */
const mide = (f: () => void): number => {
  const t = performance.now();
  f();
  return performance.now() - t;
};

describe('texto lineal', () => {
  it('plano quita etiquetas y deja un «<» suelto como texto', () => {
    expect(plano('<b>hola</b> a < b &amp; c')).toBe('hola a < b & c');
    expect(plano('<td class="x">1520,00</td>')).toBe('1520,00');
  });
  it('200 KB de «<» terminan en milisegundos (sin retroceso cuadrático)', () => {
    const mal = '<'.repeat(200_000);
    expect(mide(() => plano(mal))).toBeLessThan(500);
    expect(mide(() => plano(`${mal}>`))).toBeLessThan(500);
    expect(plano(mal)).toBe(mal);
  });
  it('200 KB de «<tr>» terminan en milisegundos', () => {
    const sinCierre = '<tr>'.repeat(50_000);
    expect(mide(() => filasDe(sinCierre))).toBeLessThan(500);
    expect(filasDe(sinCierre)).toEqual([]);
    const celdas = '<tr><td>1</td>'.repeat(14_000);
    expect(mide(() => filasDe(celdas))).toBeLessThan(500);
    const pares = '<tr></tr>'.repeat(22_000);
    expect(mide(() => filasDe(pares))).toBeLessThan(500);
    expect(mide(() => filasDe(`<tr>${'<td>'.repeat(50_000)}`))).toBeLessThan(500);
    expect(mide(() => filasDe(`<tr>${'</t'.repeat(70_000)}</tr>`))).toBeLessThan(500);
  });
  it('filasDe lee filas y celdas td/th, sin importar mayúsculas, y no confunde <track>', () => {
    expect(filasDe('<TABLE><TR class="a"><TH>Moneda</TH><td>Compra</td></TR><tr><td>USD</td><td>12,06</td></tr><track></table>')).toEqual([
      ['Moneda', 'Compra'], ['USD', '12,06'],
    ]);
  });
});

describe('días hábiles', () => {
  it('cuenta lunes a viernes en (desde, hasta]', () => {
    expect(diasHabilesEntre('2026-11-06', '2026-11-09', 'BO')).toBe(1); // vie → lun
    expect(diasHabilesEntre('2026-11-06', '2026-11-06', 'BO')).toBe(0);
    expect(diasHabilesEntre('2026-11-09', '2026-11-06', 'BO')).toBe(0);
    expect(diasHabilesEntre('2026-11-02', '2026-11-13', 'BO')).toBe(9);
  });
  it('descuenta los feriados del calendario inyectado, por mercado', () => {
    const esFeriado = (f: string, m: string) => m === 'AR' && f === '2026-11-09';
    expect(diasHabilesEntre('2026-11-06', '2026-11-10', 'AR', esFeriado)).toBe(1);
    expect(diasHabilesEntre('2026-11-06', '2026-11-10', 'BO', esFeriado)).toBe(2);
  });
  it('un intervalo enorme no se recorre entero', () => {
    expect(diasHabilesEntre('2000-01-01', '2026-11-04', 'BO')).toBeGreaterThan(400);
  });
});
