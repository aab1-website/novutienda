import type { Moneda } from '@novutienda/nucleo';
import type { MontosPorMoneda, TotalesMoneda, TotalesTurno, TurnoPos } from '../../api/tipos.js';
import { MONEDAS } from '../../api/tipos.js';

export const TOTALES_VACIOS: TotalesMoneda = { efectivo: 0, qr: 0, transferencia: 0, credito: 0, ingresos: 0, egresos: 0 };

/** Efectivo esperado: apertura + efectivo neto + ingresos − egresos (QR, transferencia y crédito nunca suman). */
export const efectivoEsperado = (apertura: number, t: TotalesMoneda): number => apertura + t.efectivo + t.ingresos - t.egresos;

export function monedasDelTurno(t: Pick<TurnoPos, 'apertura' | 'totales'>): Moneda[] {
  return MONEDAS.filter((m) => t.apertura[m] !== undefined || t.totales[m] !== undefined);
}

export interface ProyeccionMoneda {
  readonly apertura: number;
  readonly efectivoEsperado: number;
  readonly qr: number;
  readonly transferencia: number;
  readonly credito: number;
  readonly ingresos: number;
  readonly egresos: number;
}

/** Supervisión en vivo: proyección por moneda (misma fórmula que el servidor). */
export function proyectarTurno(t: Pick<TurnoPos, 'apertura' | 'totales'>): Partial<Record<Moneda, ProyeccionMoneda>> {
  const r: Partial<Record<Moneda, ProyeccionMoneda>> = {};
  for (const m of monedasDelTurno(t)) {
    const x = t.totales[m] ?? TOTALES_VACIOS;
    const apertura = t.apertura[m] ?? 0;
    r[m] = { apertura, efectivoEsperado: efectivoEsperado(apertura, x), qr: x.qr, transferencia: x.transferencia, credito: x.credito, ingresos: x.ingresos, egresos: x.egresos };
  }
  return r;
}

/** Diferencia = contado − esperado, SIN tope en cero (una falta queda negativa). */
export function diferenciaPorMoneda(t: Pick<TurnoPos, 'apertura' | 'totales'>, contado: MontosPorMoneda): Partial<Record<Moneda, number>> {
  const r: Partial<Record<Moneda, number>> = {};
  const p = proyectarTurno(t);
  for (const m of MONEDAS) {
    const c = contado[m];
    const e = p[m];
    if (c !== undefined && e !== undefined) r[m] = c - e.efectivoEsperado;
  }
  return r;
}

/** Suma `delta` a los totales de una moneda (devuelve un objeto nuevo). */
export function sumarTotales(totales: TotalesTurno, moneda: Moneda, delta: Partial<TotalesMoneda>): TotalesTurno {
  const b = totales[moneda] ?? TOTALES_VACIOS;
  return {
    ...totales,
    [moneda]: {
      efectivo: b.efectivo + (delta.efectivo ?? 0), qr: b.qr + (delta.qr ?? 0), transferencia: b.transferencia + (delta.transferencia ?? 0),
      credito: b.credito + (delta.credito ?? 0), ingresos: b.ingresos + (delta.ingresos ?? 0), egresos: b.egresos + (delta.egresos ?? 0),
    },
  };
}
