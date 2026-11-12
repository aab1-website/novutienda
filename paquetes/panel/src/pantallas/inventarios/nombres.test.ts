import { MERCADOS } from '@novutienda/nucleo';
import { describe, expect, it } from 'vitest';
import { MERCADOS_PRECIO, nombreAlmacen, nombreTipo } from './nombres.js';

describe('nombres legibles', () => {
  it('almacenes y tipos de movimiento', () => {
    expect(nombreAlmacen('deposito-1')).toBe('Depósito 1');
    expect(nombreAlmacen('otro')).toBe('otro');
    expect(nombreTipo('anulacion')).toBe('Anulación');
    expect(nombreTipo('raro')).toBe('raro');
  });
  it('los mercados salen del núcleo, con su clave de precio', () => {
    expect(MERCADOS_PRECIO.map((m) => m.mercado)).toEqual([...MERCADOS]);
    expect(MERCADOS_PRECIO.map((m) => m.clave)).toEqual(['bo', 'ar']);
  });
});
