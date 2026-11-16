import { describe, expect, it } from 'vitest';
import { mercadosDePrecio, nombreAlmacen, nombreMoneda, nombreTipo } from './nombres.js';

describe('nombres legibles', () => {
  it('almacenes y tipos de movimiento', () => {
    expect(nombreAlmacen('deposito-1')).toBe('Depósito 1');
    expect(nombreAlmacen('otro')).toBe('otro');
    expect(nombreTipo('anulacion')).toBe('Anulación');
    expect(nombreTipo('raro')).toBe('raro');
  });
  it('los mercados salen de lo declarado por el comercio, con su clave de precio y su nombre', () => {
    const m = mercadosDePrecio([
      { id: 'BO', nombre: 'Bolivia', monedaVenta: 'BOB', monedaBase: 'USD', tieneTipoCambio: true },
      { id: 'PE', nombre: 'Perú', monedaVenta: 'PEN', monedaBase: 'PEN', tieneTipoCambio: false },
    ]);
    expect(m.map((x) => x.clave)).toEqual(['bo', 'pe']);
    expect(m.map((x) => x.nombre)).toEqual(['Bolivia', 'Perú']);
  });
  it('nombra las monedas conocidas y deja el código de las demás', () => {
    expect(nombreMoneda('USD')).toBe('dólares');
    expect(nombreMoneda('PEN')).toBe('PEN');
  });
});
