import { describe, expect, it } from 'vitest';
import type { Redondeo } from '@novutienda/nucleo';
import type { CotizacionCliente } from './cotizacion-cliente.js';
import { precioFinal } from '@novutienda/nucleo';
import { formatearMonto } from './dinero.js';
import { totalReferencial, type PreciosProductos } from './total-referencial.js';

const redondeo: Redondeo = {
  BOB: { tipo: 'decimales', decimales: 0, modo: 'arriba' },
  ARS: { tipo: 'multiplo', multiplo: 1000, modo: 'arriba' },
};
const cot = (par: string, valor: number): CotizacionCliente => ({ cotizacionId: 'x', par, valor, fecha: '2026-11-04', fuente: 'prueba', estado: 'vigente' });
const precios: PreciosProductos = {
  'tv-1': { BO: 100, AR: 100 },
  'lav-2': { BO: 50, AR: 50 },
  'sin-3': { BO: 0, AR: 0 },
};
const pedido = [
  { id: 'tv-1', nombre: 'TV', cantidad: 2 },
  { id: 'lav-2', nombre: 'Lavadora', cantidad: 1 },
];

function esperado(usd: number, mercado: 'BO' | 'AR', c: CotizacionCliente): number {
  const r = precioFinal(usd, mercado, { par: c.par, valor: c.valor }, redondeo);
  if (r.tipo !== 'precio') throw new Error('sin precio');
  return r.centavos;
}

describe('total referencial', () => {
  for (const [mercado, par, moneda] of [['BO', 'BOB/USD', 'BOB'], ['AR', 'ARS/USD', 'ARS']] as const) {
    it(`suma con precioFinal en ${moneda}`, () => {
      const c = cot(par, mercado === 'BO' ? 10 : 1000);
      const t = totalReferencial(pedido, precios, mercado, c, redondeo);
      const centavos = esperado(100, mercado, c) * 2 + esperado(50, mercado, c);
      expect(t).toEqual({
        tipo: 'total', centavos, texto: formatearMonto(centavos, moneda), sinPrecio: 0,
        lineas: [
          { id: 'tv-1', unitario: formatearMonto(esperado(100, mercado, c), moneda), subtotal: formatearMonto(esperado(100, mercado, c) * 2, moneda) },
          { id: 'lav-2', unitario: formatearMonto(esperado(50, mercado, c), moneda), subtotal: formatearMonto(esperado(50, mercado, c), moneda) },
        ],
      });
    });
  }

  it('un producto con precio 0 o ausente no suma y se cuenta como «a consultar»', () => {
    const c = cot('BOB/USD', 10);
    const t = totalReferencial([...pedido, { id: 'sin-3', nombre: 'S', cantidad: 4 }, { id: 'nuevo-9', nombre: 'N', cantidad: 1 }], precios, 'BO', c, redondeo);
    expect(t.tipo).toBe('total');
    if (t.tipo === 'total') {
      expect(t.sinPrecio).toBe(2);
      expect(t.centavos).toBe(esperado(100, 'BO', c) * 2 + esperado(50, 'BO', c));
    }
  });

  it('si ningún producto tiene precio, no hay total', () => {
    expect(totalReferencial([{ id: 'sin-3', nombre: 'S', cantidad: 1 }], precios, 'BO', undefined, redondeo)).toEqual({ tipo: 'a_consultar', sinPrecio: 1, lineas: [{ id: 'sin-3', unitario: null, subtotal: null }] });
  });

  it('sin cotización no se inventa un total; mientras carga, tampoco', () => {
    expect(totalReferencial(pedido, precios, 'BO', null, redondeo)).toEqual({ tipo: 'sin_cotizacion' });
    expect(totalReferencial(pedido, precios, 'BO', undefined, redondeo)).toEqual({ tipo: 'cargando' });
  });
});
