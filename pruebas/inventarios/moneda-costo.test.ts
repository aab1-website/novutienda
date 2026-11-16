// El costo se interpreta en la moneda de costo del comercio (`monedaCostoDe`): USD si no declara otra. Los datos no se migran.
import { describe, expect, it } from 'vitest';
import type { ConfiguracionComercial } from '@novutienda/nucleo';
import { EntradaInvalida, exportarProductosCsv, leerCsvFilas, type ProductoExportable } from './api.js';
import { COMERCIAL_TRES } from './entorno.js';

const BOB: ConfiguracionComercial = { ...COMERCIAL_TRES, monedaCosto: 'BOB' };
const cab = (costo: string): string => `id,nombre,${costo}\r\n`;
const costoDe = (csv: string, c: ConfiguracionComercial): number | undefined => leerCsvFilas(csv, false, c).filas[0]?.datos.costoUSD;

describe('moneda de costo USD (o sin configurar): igual que siempre', () => {
  for (const c of [COMERCIAL_TRES, { ...COMERCIAL_TRES, monedaCosto: 'USD' }]) {
    it('costoUSD en centavos y costo en dólares', () => {
      expect(costoDe(`${cab('costoUSD')}a1,A,1234\r\n`, c)).toBe(1234);
      expect(costoDe(`${cab('costo')}a1,A,12.34\r\n`, c)).toBe(1234);
    });
    it('costobob no es un encabezado de costo', () => {
      expect(costoDe(`${cab('costobob')}a1,A,12.34\r\n`, c)).toBeUndefined();
    });
  }
  it('un importe inválido nombra USD', () => {
    expect(JSON.stringify(leerCsvFilas(`${cab('costo')}a1,A,1.234\r\n`, false, COMERCIAL_TRES).filas[0]?.errores)).toContain('USD');
  });
});

describe('moneda de costo BOB', () => {
  it('acepta costo y costobob en importe decimal', () => {
    expect(costoDe(`${cab('costo')}a1,A,12.34\r\n`, BOB)).toBe(1234);
    expect(costoDe(`${cab('costoBOB')}a1,A,12.34\r\n`, BOB)).toBe(1234);
  });
  it('rechaza costoUSD con el mensaje', () => {
    expect(() => leerCsvFilas(`${cab('costoUSD')}a1,A,1234\r\n`, false, BOB)).toThrow(EntradaInvalida);
    expect(() => leerCsvFilas(`${cab('costoUSD')}a1,A,1234\r\n`, false, BOB)).toThrow('La moneda de costo de este comercio es BOB: use la columna «costo» (importe en BOB)');
  });
  it('rechaza las variantes del encabezado costoUSD', () => {
    for (const h of ['Costo USD', 'costo_usd', 'COSTO-usd', 'Cóstó USD']) {
      expect(() => leerCsvFilas(`${cab(h)}a1,A,1234\r\n`, false, BOB), h).toThrow(EntradaInvalida);
    }
  });
  it('costo y costobob a la vez es columna repetida', () => {
    expect(() => leerCsvFilas('id,nombre,costo,costobob\r\na1,A,1,2\r\n', false, BOB)).toThrow('columna repetida');
  });
  it('los errores de importe nombran BOB', () => {
    const m = JSON.stringify(leerCsvFilas(`${cab('costo')}a1,A,1.234\r\n`, false, BOB).filas[0]?.errores);
    expect(m).toContain('BOB');
    expect(m).not.toContain('USD');
  });
});

describe('exportación e ida y vuelta', () => {
  const prod = (costoUSD: number): ProductoExportable => ({
    id: 'a1', nombre: 'A', categoria: 'c', sku: 'S1', conSerie: false, precioUSD: { bo: 100, ar: 200 }, costoUSD, activo: true, publicado: false,
  });
  for (const [nombre, c] of [['USD', COMERCIAL_TRES], ['BOB', BOB]] as const) {
    it(`${nombre}: el encabezado es costo, decimal, y vuelve igual`, () => {
      const csv = exportarProductosCsv([prod(1234)], c);
      expect(csv.split('\r\n')[0]!.split(',')).toContain('costo');
      expect(csv.split('\r\n')[1]).toContain('12.34');
      expect(costoDe(csv, c)).toBe(1234);
    });
  }
});

describe('moneda de costo EUR (tercera moneda)', () => {
  const EUR: ConfiguracionComercial = { ...COMERCIAL_TRES, monedaCosto: 'EUR' };
  it('acepta costoeur y costobob no cuenta como costo', () => {
    expect(costoDe(`${cab('costoeur')}a1,A,12.34\r\n`, EUR)).toBe(1234);
    expect(costoDe(`${cab('costobob')}a1,A,12.34\r\n`, EUR)).toBeUndefined();
  });
});
