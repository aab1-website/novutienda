/**
 * Precio final = precio base en USD × cotización del mercado, redondeado según
 * una regla que el llamador debe pasar: la política de redondeo está sin
 * decidir y no hay valor por defecto a propósito.
 */
import { MONEDA_DE, PAR_DE, type Mercado, type Moneda } from './tipos.js';

export type ModoRedondeo = 'cercano' | 'arriba' | 'abajo';

export type ReglaRedondeo =
  | { readonly tipo: 'ninguno' }
  | { readonly tipo: 'decimales'; readonly decimales: number; readonly modo: ModoRedondeo }
  /** Al múltiplo más cercano/superior/inferior de `multiplo` (por ejemplo, de 5 en 5). */
  | { readonly tipo: 'multiplo'; readonly multiplo: number; readonly modo: ModoRedondeo };

export type Redondeo = Readonly<Record<Moneda, ReglaRedondeo>>;

export type PrecioFinal =
  /** Hay precio calculado. */
  | { readonly tipo: 'precio'; readonly moneda: Moneda; readonly monto: number }
  /** Precio base 0: no es «gratis», es «sin precio / a consultar». */
  | { readonly tipo: 'sin_precio' }
  | { readonly tipo: 'invalido'; readonly motivo: string };

const aplicar = (x: number, modo: ModoRedondeo): number =>
  modo === 'arriba' ? Math.ceil(x) : modo === 'abajo' ? Math.floor(x) : Math.round(x);
/** Quita el ruido de coma flotante (p. ej. 1.005 * 100 = 100.49999999999999). */
const limpiar = (x: number): number => Number(x.toPrecision(12));

export function redondear(monto: number, regla: ReglaRedondeo): number {
  if (regla.tipo === 'ninguno') return limpiar(monto);
  if (regla.tipo === 'decimales') {
    const f = 10 ** regla.decimales;
    return aplicar(limpiar(monto * f), regla.modo) / f;
  }
  return limpiar(aplicar(limpiar(monto / regla.multiplo), regla.modo) * regla.multiplo);
}

function reglaValida(r: ReglaRedondeo | undefined): boolean {
  if (!r) return false;
  if (r.tipo === 'decimales') return Number.isInteger(r.decimales) && r.decimales >= 0 && r.decimales <= 6;
  if (r.tipo === 'multiplo') return Number.isFinite(r.multiplo) && r.multiplo > 0;
  return r.tipo === 'ninguno';
}

export function precioFinal(
  usd: number,
  mercado: Mercado,
  cotizacion: { readonly par: string; readonly valor: number },
  redondeo: Redondeo,
): PrecioFinal {
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0) return { tipo: 'invalido', motivo: 'el precio base en USD debe ser un número no negativo' };
  if (usd === 0) return { tipo: 'sin_precio' };
  if (cotizacion.par !== PAR_DE[mercado]) return { tipo: 'invalido', motivo: `la cotización ${cotizacion.par} no corresponde al mercado ${mercado}` };
  if (!Number.isFinite(cotizacion.valor) || cotizacion.valor <= 0) return { tipo: 'invalido', motivo: 'el valor de la cotización debe ser positivo' };
  const moneda = MONEDA_DE[mercado];
  const regla = redondeo[moneda];
  if (!reglaValida(regla)) return { tipo: 'invalido', motivo: `falta una regla de redondeo válida para ${moneda}` };
  const monto = redondear(usd * cotizacion.valor, regla);
  if (monto <= 0) return { tipo: 'invalido', motivo: 'el redondeo dejó el precio en cero' };
  return { tipo: 'precio', moneda, monto };
}
