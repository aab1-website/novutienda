import { describe, expect, it } from 'vitest';
import type { CotizacionesVigentes, MercadoDeclarado } from '../../api/tipos.js';
import { precioDeCobro } from './arqueo.js';

// Valores calculados a mano con la regla de `centavosDeLinea` (paquetes/pos/src/precio.ts). El panel no declara
// `@novutienda/pos` como dependencia (la frontera lo impide), así que no se compara contra la función del servidor:
// se fijan los montos que el servidor acepta en cada caso.
const reglas = { BOB: { tipo: 'multiplo', multiplo: 5, modo: 'cercano' }, ARS: { tipo: 'decimales', decimales: 2, modo: 'cercano' } } as never;
const producto = { precioUSD: { bo: 800, ar: 803 } } as never;
const cot = { BO: { par: 'BOB/USD', valor: 6.96, fuente: 'x', fecha: '2026-11-14' }, AR: null } as unknown as CotizacionesVigentes;
const mercado = (o: Partial<MercadoDeclarado>): MercadoDeclarado => ({ id: 'BO', nombre: 'Bolivia', monedaVenta: 'BOB', monedaBase: 'USD', tieneTipoCambio: false, ...o });
const centavos = (p: ReturnType<typeof precioDeCobro>): number | string => (p.tipo === 'precio' ? p.centavos : p.tipo);

describe('precioDeCobro: equivale al precio que acepta el servidor', () => {
  it('sin tipo de cambio y moneda base distinta: redondea con la regla de la moneda de venta (8,00 → 10,00)', () => {
    const r = precioDeCobro(producto, mercado({}), 'USD', cot, reglas);
    expect(centavos(r)).toBe(1000);
    expect(r).toMatchObject({ moneda: 'USD' });
  });
  it('sin tipo de cambio en la moneda de venta: el mismo monto', () => {
    expect(centavos(precioDeCobro(producto, mercado({}), 'BOB', cot, reglas))).toBe(1000);
  });
  it('con tipo de cambio: la moneda base va sin conversión ni redondeo', () => {
    expect(centavos(precioDeCobro(producto, mercado({ tieneTipoCambio: true }), 'USD', cot, reglas))).toBe(800);
  });
  it('con tipo de cambio en la moneda de venta: 8,00 × 6,96 = 55,68 → 55,00', () => {
    expect(centavos(precioDeCobro(producto, mercado({ tieneTipoCambio: true }), 'BOB', cot, reglas))).toBe(5500);
  });
  it('misma moneda de venta y base sin tipo de cambio: redondea (8,03 con dos decimales queda igual)', () => {
    const m = mercado({ id: 'AR', monedaVenta: 'ARS', monedaBase: 'ARS' });
    expect(centavos(precioDeCobro(producto, m, 'ARS', cot, reglas))).toBe(803);
  });
  it('sin precio en el mercado: sin_precio', () => {
    expect(centavos(precioDeCobro({ precioUSD: { bo: 0, ar: 0 } } as never, mercado({}), 'USD', cot, reglas))).toBe('sin_precio');
  });
});
