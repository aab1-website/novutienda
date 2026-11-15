// Precio del día por mercado declarado (`preciosDelDiaDe`) y tablero por mercado (D24). La referencia es el comportamiento
// del tenant de tres monedas: `precioFinal` del núcleo con la política vigente por moneda.
import { obtenerTablero, preciosDelDia, preciosDelDiaDe } from '@novutienda/consola';
import {
  COMERCIAL_LEGADO_TRES_MONEDAS, type ConfiguracionComercial, type CopiaCotizacion, type Redondeo, type RedondeoPorMoneda,
} from '@novutienda/nucleo';
import { describe, expect, it } from 'vitest';
import { actor, nuevaDb, RelojFijo, T } from './dobles.js';

const REDONDEO: RedondeoPorMoneda = {
  BOB: { tipo: 'decimales', decimales: 2, modo: 'cercano' },
  ARS: { tipo: 'multiplo', multiplo: 100, modo: 'cercano' },
};
const copia = (par: string, valor: number): CopiaCotizacion<string> => ({ cotizacionId: 'x', par, valor, fecha: '2026-11-04', fuente: 'BCB', estado: 'vigente' });
const COT = { BO: copia('BOB/USD', 6.965), AR: copia('ARS/USD', 1187.35) };

// Mercado sin tipo de cambio (moneda base = moneda de venta) junto a los dos legados.
const CON_LOCAL: ConfiguracionComercial = {
  ...COMERCIAL_LEGADO_TRES_MONEDAS,
  mercados: [
    ...COMERCIAL_LEGADO_TRES_MONEDAS.mercados,
    { id: 'PE', nombre: 'Perú', monedaVenta: 'PEN', monedaBase: 'PEN', zonaHoraria: 'America/Lima', tipoCambio: null, redondeo: { tipo: 'decimales', decimales: 2, modo: 'arriba' } },
  ],
  monedas: ['BOB', 'USD', 'ARS', 'PEN'],
};

describe('preciosDelDiaDe', () => {
  it('con la configuración de tres monedas da lo mismo que la función vieja preciosDelDia (propiedad con semilla fija)', () => {
    let s = 20261114;
    const sig = (): number => { s = (s * 1_664_525 + 1_013_904_223) % 4_294_967_296; return s / 4_294_967_296; };
    for (let i = 0; i < 500; i++) {
      const bo = Math.round(sig() * 100_000) / 100, ar = Math.round(sig() * 100_000) / 100;
      // Alterna cotizaciones ausentes para ejercitar `sin_cotizacion`.
      const cot = { ...(i % 5 === 1 ? {} : { BO: COT.BO }), ...(i % 7 === 3 ? {} : { AR: COT.AR }) };
      const r = preciosDelDiaDe({ bo, ar }, COMERCIAL_LEGADO_TRES_MONEDAS, cot, REDONDEO);
      const esperado = preciosDelDia({ bo, ar }, cot as Parameters<typeof preciosDelDia>[1], REDONDEO as Redondeo);
      expect(r['BO'], `bo=${bo} i=${i}`).toEqual(esperado.BO);
      expect(r['AR'], `ar=${ar} i=${i}`).toEqual(esperado.AR);
    }
  });

  it('valores fijos del tenant de referencia', () => {
    const r = preciosDelDiaDe({ bo: 10, ar: 10.5 }, COMERCIAL_LEGADO_TRES_MONEDAS, { BO: copia('BOB/USD', 12.06), AR: copia('ARS/USD', 1520) }, REDONDEO);
    expect(r['BO']).toEqual({ tipo: 'precio', moneda: 'BOB', monto: 120.6, centavos: 12060 });
    expect(r['AR']).toMatchObject({ tipo: 'precio', moneda: 'ARS', monto: 16000 });
    expect(preciosDelDiaDe({ bo: 0, ar: 5 }, COMERCIAL_LEGADO_TRES_MONEDAS, { BO: copia('BOB/USD', 12.06) }, REDONDEO))
      .toEqual({ BO: { tipo: 'sin_precio' }, AR: { tipo: 'sin_cotizacion' } });
  });

  it('el redondeo es el vigente del comercio, no el del mercado', () => {
    // El mercado BO declara «cercano»; el comercio vigente redondea hacia arriba: 10 × 6.965 = 69.65 → a múltiplo de 100 arriba = 100.
    const r = preciosDelDiaDe({ bo: 10, ar: 1 }, COMERCIAL_LEGADO_TRES_MONEDAS, COT, { ...REDONDEO, BOB: { tipo: 'multiplo', multiplo: 100, modo: 'arriba' } });
    expect(r['BO']).toMatchObject({ tipo: 'precio', monto: 100 });
  });

  it('un mercado sin tipo de cambio da el precio base redondeado con sinCotizacion; ignora cotizaciones', () => {
    const r = preciosDelDiaDe({ bo: 1, ar: 1, pe: 10.231 }, CON_LOCAL, COT, { ...REDONDEO, PEN: { tipo: 'decimales', decimales: 2, modo: 'arriba' } });
    expect(r['PE']).toEqual({ tipo: 'precio', moneda: 'PEN', monto: 10.24, centavos: 1024, sinCotizacion: true });
  });

  it('un mercado al que le falta precio da falta_precio; sin cotización utilizable, sin_cotizacion', () => {
    const r = preciosDelDiaDe({ pe: 5 }, CON_LOCAL, { BO: COT.BO }, { ...REDONDEO, PEN: { tipo: 'decimales', decimales: 2, modo: 'cercano' } });
    expect(r['BO']).toEqual({ tipo: 'falta_precio' });
    expect(r['AR']).toEqual({ tipo: 'falta_precio' });
    expect(r['PE']).toMatchObject({ tipo: 'precio', monto: 5 });
    expect(preciosDelDiaDe({ ar: 5 }, CON_LOCAL, { BO: COT.BO }, REDONDEO)['AR']).toEqual({ tipo: 'sin_cotizacion' });
  });
});

describe('tablero por mercado declarado (D24)', () => {
  it('un mercado sin tipo de cambio no aparece en la lista de cotizaciones', async () => {
    const db = nuevaDb();
    const t = await obtenerTablero(
      { db, reloj: new RelojFijo(), comercial: CON_LOCAL, cotizaciones: { leer: async () => null, transaccion: () => Promise.reject(new Error('no usada')) } as never },
      { tenantId: T, actor: actor('sup') },
    );
    expect(t.cotizaciones.map((c) => c.mercado)).toEqual(['BO', 'AR']);
  });
});
