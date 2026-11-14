import { describe, expect, it } from 'vitest';
import { precioDeMercado, precioFinal, type Mercado, type ModoRedondeo, type ReglaRedondeo } from '@novutienda/nucleo';

// Un solo cálculo de precio (D7): `precioFinal` (legado) es una envoltura de `precioDeMercado`. Prueba de propiedades con un
// generador determinista (mulberry32, semilla fija, sin dependencias) y una copia literal del cálculo de main como referencia.

function mulberry32(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MODOS: readonly ModoRedondeo[] = ['cercano', 'arriba', 'abajo'];
const REGLAS: ReglaRedondeo[] = [
  ...MODOS.flatMap((modo) => [0, 1, 2].map((decimales) => ({ tipo: 'decimales', decimales, modo }) as const)),
  ...MODOS.flatMap((modo) => [100, 50, 5, 0.05, 0.01, 0.25, 0.5, 1, 10, 0.1, 0.07].map((multiplo) => ({ tipo: 'multiplo', multiplo, modo }) as const)),
];
const MERCADOS = [
  { mercado: 'BO', par: 'BOB/USD', moneda: 'BOB' },
  { mercado: 'AR', par: 'ARS/USD', moneda: 'ARS' },
] as const;

// --- Referencia: el cálculo de `precioFinal` de main, copiado tal cual (solo para las reglas admitidas) ---
const limpiar = (x: number): number => Number(x.toPrecision(12));
const aplicar = (x: number, modo: ModoRedondeo): number => (modo === 'arriba' ? Math.ceil(x) : modo === 'abajo' ? Math.floor(x) : Math.round(x));
function redondearMain(monto: number, r: ReglaRedondeo): number {
  if (r.tipo === 'decimales') { const f = 10 ** r.decimales; return aplicar(limpiar(monto * f), r.modo) / f; }
  return limpiar(aplicar(limpiar(monto / r.multiplo), r.modo) * r.multiplo);
}
function precioMain(usd: number, moneda: string, cot: number, regla: ReglaRedondeo): unknown {
  if (usd === 0) return { tipo: 'sin_precio' };
  if (!Number.isFinite(cot) || cot <= 0) return { tipo: 'invalido', motivo: 'el valor de la cotización debe ser positivo' };
  const monto = redondearMain(usd * cot, regla);
  if (monto <= 0) return { tipo: 'invalido', motivo: 'el redondeo dejó el precio en cero' };
  if (!Number.isSafeInteger(Math.round(limpiar(monto * 100)))) return { tipo: 'invalido', motivo: 'el precio es demasiado grande' };
  return { tipo: 'precio', moneda, monto, centavos: Math.round(limpiar(monto * 100)) };
}

describe('un solo cálculo de precio', () => {
  const rnd = mulberry32(20261113);
  const casos = Array.from({ length: 6000 }, () => {
    const m = MERCADOS[Math.floor(rnd() * MERCADOS.length)]!;
    const baseCentavos = rnd() < 0.1 ? Math.floor(rnd() * 5) : Math.floor(rnd() ** 3 * 5_000_000);
    const cotizacion = Number((rnd() < 0.3 ? rnd() * 3 + 0.0005 : rnd() * 2000 + 0.01).toFixed(rnd() < 0.5 ? 2 : 4)) || 1;
    return { ...m, usd: baseCentavos / 100, cotizacion, regla: REGLAS[Math.floor(rnd() * REGLAS.length)]! };
  });

  it('precioFinal y precioDeMercado dan exactamente lo mismo para toda regla admitida', () => {
    expect(casos.length).toBeGreaterThanOrEqual(6000);
    let precios = 0;
    for (const c of casos) {
      const cot = { par: c.par, valor: c.cotizacion };
      const legado = precioFinal(c.usd, c.mercado as Mercado, cot, { BOB: c.regla, ARS: c.regla });
      const nuevo = precioDeMercado(c.usd, { id: c.mercado, monedaVenta: c.moneda, monedaBase: 'USD', tipoCambio: { par: c.par, fuentes: ['manual'] }, redondeo: c.regla }, cot);
      expect(legado, JSON.stringify(c)).toEqual(nuevo);
      if (legado.tipo === 'precio') precios++;
    }
    expect(precios).toBeGreaterThan(3000);
  });

  it('el resultado no cambió respecto de main para las reglas admitidas (salvo el caso < 1 centavo, que con ellas no existe)', () => {
    for (const c of casos) {
      const r = precioFinal(c.usd, c.mercado as Mercado, { par: c.par, valor: c.cotizacion }, { BOB: c.regla, ARS: c.regla });
      expect(r, JSON.stringify(c)).toEqual(precioMain(c.usd, c.moneda, c.cotizacion, c.regla));
    }
  });

  it('el monto es siempre exactamente los centavos y nunca menor a un centavo', () => {
    for (const c of casos) {
      const r = precioFinal(c.usd, c.mercado as Mercado, { par: c.par, valor: c.cotizacion }, { BOB: c.regla, ARS: c.regla });
      if (r.tipo === 'precio') {
        expect(r.centavos).toBeGreaterThanOrEqual(1);
        expect(r.monto).toBe(r.centavos / 100);
      }
    }
  });

  it('las entradas inválidas dan el mismo rechazo por las dos vías', () => {
    const regla = REGLAS[0]!;
    const m = { id: 'BO', monedaVenta: 'BOB', monedaBase: 'USD', tipoCambio: { par: 'BOB/USD', fuentes: ['manual' as const] }, redondeo: regla };
    for (const [usd, cot] of [[-1, 12.06], [Number.NaN, 12.06], [10, 0], [10, -2], [10, Number.NaN], [1e300, 12.06]] as const) {
      const c = { par: 'BOB/USD', valor: cot };
      expect(precioFinal(usd, 'BO', c, { BOB: regla, ARS: regla })).toEqual(precioDeMercado(usd, m, c));
    }
    const ajena = { par: 'ARS/USD', valor: 1520 };
    expect(precioFinal(10, 'BO', ajena, { BOB: regla, ARS: regla })).toEqual({ tipo: 'invalido', motivo: 'la cotización ARS/USD no corresponde al mercado BO' });
  });
});
