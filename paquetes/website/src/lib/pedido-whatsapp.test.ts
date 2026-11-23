import { describe, expect, it } from 'vitest';
import type { Redondeo } from '@novutienda/nucleo';
import type { CotizacionCliente } from './cotizacion-cliente.js';
import { totalReferencial, type PreciosProductos } from './total-referencial.js';
import { LEYENDA_TOTAL, MAX_MENSAJE, enlaceWhatsApp, mensajeContacto, mensajePedido } from './whatsapp.js';

const redondeo: Redondeo = {
  BOB: { tipo: 'decimales', decimales: 0, modo: 'arriba' },
  ARS: { tipo: 'multiplo', multiplo: 1000, modo: 'arriba' },
};
const cot = (par: string, valor: number): CotizacionCliente => ({ cotizacionId: 'x', par, valor, fecha: '2026-11-04', fuente: 'prueba', estado: 'vigente' });
const precios: PreciosProductos = { 'tv-1': { BO: 100, AR: 100 }, 'sin-3': { BO: 0, AR: 0 } };

describe('mensaje del pedido con precios', () => {
  it('BO: cantidad, nombre, código, precio unitario, subtotal, total y leyenda con el mismo formato de la pantalla', () => {
    const carrito = [{ id: 'tv-1', nombre: 'TV', cantidad: 2 }];
    const t = totalReferencial(carrito, precios, 'BO', cot('BOB/USD', 10), redondeo);
    if (t.tipo !== 'total') throw new Error('sin total');
    expect(mensajePedido(carrito, t.lineas, t.texto)).toBe([
      'Hola, quiero comprar estos productos:',
      '2 x TV (cód. tv-1): Bs 1.000 c/u, subtotal Bs 2.000',
      'Total referencial: Bs 2.000',
      LEYENDA_TOTAL,
    ].join('\n'));
  });

  it('AR: usa la moneda y el redondeo del mercado', () => {
    const carrito = [{ id: 'tv-1', nombre: 'TV', cantidad: 3 }];
    const t = totalReferencial(carrito, precios, 'AR', cot('ARS/USD', 1000), redondeo);
    if (t.tipo !== 'total') throw new Error('sin total');
    const m = mensajePedido(carrito, t.lineas, t.texto);
    expect(m).toContain('3 x TV (cód. tv-1): $ 100.000 c/u, subtotal $ 300.000');
    expect(m).toContain('Total referencial: $ 300.000');
  });

  it('un producto sin precio se marca «a consultar» y no suma', () => {
    const carrito = [{ id: 'tv-1', nombre: 'TV', cantidad: 1 }, { id: 'sin-3', nombre: 'Raro', cantidad: 1 }];
    const t = totalReferencial(carrito, precios, 'BO', cot('BOB/USD', 10), redondeo);
    if (t.tipo !== 'total') throw new Error('sin total');
    const m = mensajePedido(carrito, t.lineas, t.texto);
    expect(m).toContain('1 x Raro (cód. sin-3): precio a consultar');
    expect(m).toContain('Total referencial: Bs 1.000');
  });

  it('sin total (precios no disponibles) no lleva montos pero sí la leyenda', () => {
    const m = mensajePedido([{ id: 'a-1', nombre: 'A', cantidad: 2 }], null, null);
    expect(m).toBe(['Hola, quiero comprar estos productos:', '2 x A (cód. a-1)', LEYENDA_TOTAL].join('\n'));
  });

  it('si no entra en MAX_MENSAJE recorta líneas y conserva el total y la leyenda', () => {
    const carrito = Array.from({ length: 60 }, (_, i) => ({ id: `prod-${i}`, nombre: `Producto de nombre bastante largo número ${i}`, cantidad: 1 }));
    const lineas = carrito.map((l) => ({ id: l.id, unitario: 'Bs 1.000', subtotal: 'Bs 1.000' }));
    const m = mensajePedido(carrito, lineas, 'Bs 60.000');
    expect(m.length).toBeLessThanOrEqual(MAX_MENSAJE);
    expect(m).toContain('x Producto de nombre bastante largo número 0 ');
    expect(m).toMatch(/… y \d+ productos más/);
    expect(m.endsWith(`Total referencial: Bs 60.000\n${LEYENDA_TOTAL}`)).toBe(true);
    const url = enlaceWhatsApp('59100000001', m)!;
    expect(decodeURIComponent(url.split('text=')[1]!)).toBe(m);
  });
});

describe('mensaje del formulario de contacto', () => {
  it('lleva el nombre y el mensaje', () => {
    expect(mensajeContacto(' Ana ', ' Quisiera un precio ')).toBe('Hola, soy Ana.\nQuisiera un precio');
  });
  it('recorta el texto largo sin pasar de MAX_MENSAJE', () => {
    expect(mensajeContacto('Ana', 'x'.repeat(5000)).length).toBe(MAX_MENSAJE);
  });
});
