// (c) Precios del día y precio final por mercado: `precioFinal` y el redondeo del núcleo, `preciosDelDiaDe` de la
// consola, `precioDeCobro` de la caja del panel y `vistaPrecio` del sitio, sobre los productos fijos y la política vigente.
import { COMERCIAL_LEGADO_TRES_MONEDAS, precioFinal, redondear, leerCotizacion } from '@novutienda/nucleo';
import { preciosDelDiaDe } from '@novutienda/consola';
import { precioDeCobro, type MercadoDeclarado } from '@novutienda/panel/pos';
import { vistaComercial } from '../../plataforma/coordinador/comercial.js';
import { vistaPrecio } from '@novutienda/website';
import { describe, expect, it } from 'vitest';
import { COTIZACION_AR, COTIZACION_BO, PRODUCTOS, REDONDEO, T, crearEscenario } from './escenario.js';
import { compararConFotoJson } from './foto.js';

const usd = (centavos: number): number => centavos / 100;

// Los mercados declarados salen de la proyección real del servidor (la misma que recibe el panel).
const MERCADOS = vistaComercial(COMERCIAL_LEGADO_TRES_MONEDAS).mercados;
const mercado = (id: 'BO' | 'AR'): MercadoDeclarado => {
  const m = MERCADOS.find((x) => x.id === id);
  if (m === undefined) throw new Error('mercado de referencia ausente');
  return m;
};
const MBO = mercado('BO');
const MAR = mercado('AR');

describe('precios por mercado del tenant de referencia', () => {
  it('precioFinal y preciosDelDia por producto y mercado, con cotización guardada', async () => {
    const e = await crearEscenario();
    const BO = await leerCotizacion(e.almacen, 'BO', e.reloj.ahora, { tenantId: T });
    const AR = await leerCotizacion(e.almacen, 'AR', e.reloj.ahora, { tenantId: T });
    expect([BO.valor, AR.valor]).toEqual([COTIZACION_BO, COTIZACION_AR]);
    const cot = { BO, AR };
    const filas = PRODUCTOS.map((f) => {
      const p = f.producto.precioUSD;
      const prod = { precioUSD: p };
      return {
        id: f.producto.id, precioUSDcentavos: p,
        precioFinal: { BO: precioFinal(usd(p.bo), 'BO', BO, REDONDEO), AR: precioFinal(usd(p.ar), 'AR', AR, REDONDEO) },
        preciosDelDia: preciosDelDiaDe({ bo: usd(p.bo), ar: usd(p.ar) }, COMERCIAL_LEGADO_TRES_MONEDAS, { BO, AR }, REDONDEO),
        preciosDelDiaSinCotizacion: preciosDelDiaDe({ bo: usd(p.bo), ar: usd(p.ar) }, COMERCIAL_LEGADO_TRES_MONEDAS, {}, REDONDEO),
        panel: {
          BOB: precioDeCobro(prod, MBO, 'BOB', cot, REDONDEO), ARS: precioDeCobro(prod, MAR, 'ARS', cot, REDONDEO),
          USD_BO: precioDeCobro(prod, MBO, 'USD', cot, REDONDEO), USD_AR: precioDeCobro(prod, MAR, 'USD', cot, REDONDEO),
          BOB_sinCotizacion: precioDeCobro(prod, MBO, 'BOB', { BO: null, AR: null }, REDONDEO),
        },
        sitio: { BO: vistaPrecio(usd(p.bo), 'BO', BO, REDONDEO), AR: vistaPrecio(usd(p.ar), 'AR', AR, REDONDEO), BOcargando: vistaPrecio(usd(p.bo), 'BO', undefined, REDONDEO), BOsinCotizacion: vistaPrecio(usd(p.bo), 'BO', null, REDONDEO) },
      };
    });
    // Debe haber redondeos hacia arriba y hacia abajo en ambos mercados (la foto los fija, esto lo garantiza).
    const exacto = (f: (typeof filas)[number], m: 'BO' | 'AR'): { dif: number } | null => {
      const bruto = usd(m === 'BO' ? f.precioUSDcentavos.bo : f.precioUSDcentavos.ar) * (m === 'BO' ? COTIZACION_BO : COTIZACION_AR);
      const p = f.precioFinal[m];
      return p.tipo === 'precio' ? { dif: p.monto - bruto } : null;
    };
    for (const m of ['BO', 'AR'] as const) {
      const difs = filas.map((f) => exacto(f, m)?.dif).filter((d): d is number => d !== undefined);
      expect(difs.some((d) => d > 1e-9), `redondeo hacia arriba en ${m}`).toBe(true);
      expect(difs.some((d) => d < -1e-9), `redondeo hacia abajo en ${m}`).toBe(true);
    }
    compararConFotoJson('precios-por-producto.json', { cotizaciones: { BO: BO, AR: AR }, redondeo: REDONDEO, filas });
  });

  it('redondear: modos y reglas de la política vigente', () => {
    const casos = [
      [{ tipo: 'decimales', decimales: 2, modo: 'cercano' }, [1.005, 2.675, 8.70625, 9.26345, 0.004, 1234.5678]],
      [{ tipo: 'multiplo', multiplo: 100, modo: 'cercano' }, [12265.4, 12349.99, 12350, 12351, 49, 51]],
    ] as const;
    compararConFotoJson('precios-redondeo.json', casos.map(([regla, valores]) => ({ regla, resultados: valores.map((v) => [v, redondear(v, regla)]) })));
  });
});
