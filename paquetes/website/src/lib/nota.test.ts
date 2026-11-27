import { describe, expect, it } from 'vitest';
import { limpiarNota, MAX_NOTA } from './nota.js';
import { mensajePedido, MAX_MENSAJE } from './whatsapp.js';

describe('nota del cliente en Mi pedido', () => {
  it('limpia: una sola línea, sin controles ni espacios repetidos, y lo que no es texto queda vacío', () => {
    expect(limpiarNota('  color negro\n\npor favor\t ')).toBe('color negro por favor');
    expect(limpiarNota('a\u0000b\u2028c')).toBe('a b c');
    expect(limpiarNota(undefined)).toBe('');
    expect(limpiarNota(42)).toBe('');
  });
  it(`recorta a ${MAX_NOTA} caracteres sin partir un emoji`, () => {
    const larga = '😀'.repeat(MAX_NOTA + 20);
    const n = limpiarNota(larga);
    expect(Array.from(n)).toHaveLength(MAX_NOTA);
    expect(() => encodeURIComponent(n)).not.toThrow();
  });
  it('va en su línea «Nota: …» después del total y antes de la leyenda', () => {
    const m = mensajePedido([{ id: 'tv-1', nombre: 'TV', cantidad: 1 }], [{ id: 'tv-1', unitario: 'Bs 1.000', subtotal: 'Bs 1.000' }] as never, 'Bs 1.000', 'Entregar después de las 18');
    expect(m.split('\n')).toEqual([
      'Hola, quiero comprar estos productos:',
      '1 x TV (cód. tv-1): Bs 1.000 c/u, subtotal Bs 1.000',
      'Total referencial: Bs 1.000',
      'Nota: Entregar después de las 18',
      'El precio final y el envío se confirman por WhatsApp',
    ]);
  });
  it('sin total, la nota va después de la última línea de producto', () => {
    const m = mensajePedido([{ id: 'tv-1', nombre: 'TV', cantidad: 1 }], null, null, 'hola');
    expect(m.split('\n').slice(1)).toEqual(['1 x TV (cód. tv-1)', 'Nota: hola', 'El precio final y el envío se confirman por WhatsApp']);
  });
  it('nota vacía o solo espacios: sin línea de nota', () => {
    expect(mensajePedido([{ id: 'tv-1', nombre: 'TV', cantidad: 1 }], null, null, '   ')).not.toContain('Nota:');
  });
  it('el recorte de 1500 caracteres quita productos, nunca la nota', () => {
    const lineas = Array.from({ length: 50 }, (_, i) => ({ id: `producto-${i}`, nombre: `PRODUCTO DE NOMBRE LARGO NÚMERO ${i}`, cantidad: 1 }));
    const nota = 'x'.repeat(MAX_NOTA);
    const m = mensajePedido(lineas, null, null, nota);
    expect(m.length).toBeLessThanOrEqual(MAX_MENSAJE);
    expect(m).toContain(`Nota: ${nota}`);
    expect(m).toMatch(/… y \d+ productos más/);
  });
});
