import { describe, expect, it } from 'vitest';
import type { Redondeo } from '@novutienda/nucleo';
import type { CotizacionCliente } from './cotizacion-cliente.js';
import { enlaceSegunPrecios } from './enlace-pedido.js';
import { totalReferencial, type PreciosProductos } from './total-referencial.js';
import { LEYENDA_TOTAL } from './whatsapp.js';

const redondeo: Redondeo = { BOB: { tipo: 'decimales', decimales: 0, modo: 'arriba' }, ARS: { tipo: 'multiplo', multiplo: 1000, modo: 'arriba' } };
const cot = (par: string, valor: number): CotizacionCliente => ({ cotizacionId: 'x', par, valor, fecha: '2026-11-04', fuente: 'prueba', estado: 'vigente' });
const precios: PreciosProductos = { 'tv-1': { BO: 100, AR: 100 } };
const linea = [{ id: 'tv-1', nombre: 'TV', cantidad: 1 }];
const texto = (e: string | null): string => decodeURIComponent((e ?? '').split('text=')[1] ?? '');

describe('enlace del pedido según la carga de precios (COMPRAR y botón flotante)', () => {
  it('mientras los precios cargan: cargando, sin enlace que enviar', () => {
    expect(enlaceSegunPrecios('59170000000', linea, null, false)).toEqual({ estado: 'cargando' });
  });
  it('con precios: una línea de cantidad 1 con precio unitario, subtotal, total referencial y leyenda (BO)', () => {
    const t = totalReferencial(linea, precios, 'BO', cot('BOB/USD', 10), redondeo);
    const r = enlaceSegunPrecios('59170000000', linea, t, false);
    expect(r.estado).toBe('listo');
    expect(texto(r.estado === 'listo' ? r.enlace : null)).toBe([
      'Hola, quiero comprar estos productos:',
      '1 x TV (cód. tv-1): Bs 1.000 c/u, subtotal Bs 1.000',
      'Total referencial: Bs 1.000',
      LEYENDA_TOTAL,
    ].join('\n'));
  });
  it('mercado AR: moneda y redondeo del mercado', () => {
    const t = totalReferencial(linea, precios, 'AR', cot('ARS/USD', 1000), redondeo);
    const r = enlaceSegunPrecios('59170000000', linea, t, false);
    expect(texto(r.estado === 'listo' ? r.enlace : null)).toContain('Total referencial:');
  });
  it('si la carga falló: degrada al mensaje sin montos, con la leyenda', () => {
    const r = enlaceSegunPrecios('59170000000', linea, null, true);
    expect(r.estado).toBe('listo');
    const m = texto(r.estado === 'listo' ? r.enlace : null);
    expect(m).toContain('1 x TV (cód. tv-1)');
    expect(m).not.toContain('Total referencial');
  });
  it('sin número del negocio: enlace nulo', () => {
    expect(enlaceSegunPrecios(null, linea, null, true)).toEqual({ estado: 'listo', enlace: null });
  });
});
