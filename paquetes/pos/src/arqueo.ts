import type { ArqueoMoneda, Moneda } from '@novutienda/nucleo';
import { ErrorPos } from './errores.js';
import { MONEDAS_POS, type MedioPago, type MontosPorMoneda, type TotalesMoneda, type TotalesTurno, type TurnoPos } from './tipos.js';

export const TOTALES_VACIOS: TotalesMoneda = { efectivo: 0, qr: 0, transferencia: 0, credito: 0, ingresos: 0, egresos: 0 };

/** Suma `delta` a los totales de una moneda (función pura; devuelve un objeto nuevo). */
export function sumarTotales(totales: TotalesTurno, moneda: Moneda, delta: Partial<TotalesMoneda>): TotalesTurno {
  const base = totales[moneda] ?? TOTALES_VACIOS;
  const nuevo: TotalesMoneda = {
    efectivo: base.efectivo + (delta.efectivo ?? 0),
    qr: base.qr + (delta.qr ?? 0),
    transferencia: base.transferencia + (delta.transferencia ?? 0),
    credito: base.credito + (delta.credito ?? 0),
    ingresos: base.ingresos + (delta.ingresos ?? 0),
    egresos: base.egresos + (delta.egresos ?? 0),
  };
  return { ...totales, [moneda]: nuevo };
}

/** Delta de totales de un importe por medio (usado por ventas, cobros y reembolsos). */
export const deltaPorMedio = (medio: MedioPago, monto: number): Partial<TotalesMoneda> =>
  medio === 'efectivo' ? { efectivo: monto } : medio === 'qr' ? { qr: monto } : medio === 'transferencia' ? { transferencia: monto } : { credito: monto };

/**
 * Efectivo esperado de una moneda:
 * apertura + efectivo neto de cambio (ventas y cobros de crédito) + ingresos − egresos − reembolsos en efectivo
 * (los reembolsos ya están restados de `efectivo`). QR, transferencia y crédito nunca suman.
 */
export const efectivoEsperado = (apertura: number, t: TotalesMoneda): number => apertura + t.efectivo + t.ingresos - t.egresos;

/** Efectivo disponible hoy en la caja para una moneda (misma fórmula que el esperado). */
export function efectivoDisponible(turno: Pick<TurnoPos, 'apertura' | 'totales'>, moneda: Moneda): number {
  return efectivoEsperado(turno.apertura[moneda] ?? 0, turno.totales[moneda] ?? TOTALES_VACIOS);
}

/** Monedas con apertura o movimiento en el turno, en orden fijo. */
export const monedasDelTurno = (turno: Pick<TurnoPos, 'apertura' | 'totales'>): Moneda[] =>
  MONEDAS_POS.filter((m) => turno.apertura[m] !== undefined || turno.totales[m] !== undefined);

/**
 * Arqueo por moneda. `diferencia = contado − esperado` SIN tope en cero: una falta queda negativa.
 * Exige conteo de toda moneda con apertura o movimiento.
 */
export function calcularArqueo(
  turno: Pick<TurnoPos, 'apertura' | 'totales'>,
  contado: MontosPorMoneda,
): Partial<Record<Moneda, ArqueoMoneda>> {
  const resultado: Partial<Record<Moneda, ArqueoMoneda>> = {};
  const monedas = new Set<Moneda>([...monedasDelTurno(turno), ...MONEDAS_POS.filter((m) => contado[m] !== undefined)]);
  for (const m of MONEDAS_POS) {
    if (!monedas.has(m)) continue;
    const c = contado[m];
    if (c === undefined) throw new ErrorPos('conteo-faltante', `Falta el conteo de efectivo en ${m}`);
    if (!Number.isSafeInteger(c) || c < 0) throw new ErrorPos('entrada-invalida', `El conteo de ${m} debe ser un entero de centavos no negativo`);
    const t = turno.totales[m] ?? TOTALES_VACIOS;
    const apertura = turno.apertura[m] ?? 0;
    const esperado = efectivoEsperado(apertura, t);
    resultado[m] = {
      apertura,
      esperado,
      contado: c,
      diferencia: c - esperado,
      efectivo: t.efectivo,
      qr: t.qr,
      transferencia: t.transferencia,
      credito: t.credito,
    };
  }
  return resultado;
}

export interface ProyeccionMoneda {
  readonly apertura: number;
  /** Efectivo que debería haber en la caja ahora. */
  readonly efectivoEsperado: number;
  readonly qr: number;
  readonly transferencia: number;
  readonly credito: number;
  readonly ingresos: number;
  readonly egresos: number;
}

/** Supervisión en vivo: proyección del turno en curso por moneda (función pura). */
export function proyectarTurno(turno: Pick<TurnoPos, 'apertura' | 'totales'>): Partial<Record<Moneda, ProyeccionMoneda>> {
  const r: Partial<Record<Moneda, ProyeccionMoneda>> = {};
  for (const m of monedasDelTurno(turno)) {
    const t = turno.totales[m] ?? TOTALES_VACIOS;
    const apertura = turno.apertura[m] ?? 0;
    r[m] = { apertura, efectivoEsperado: efectivoEsperado(apertura, t), qr: t.qr, transferencia: t.transferencia, credito: t.credito, ingresos: t.ingresos, egresos: t.egresos };
  }
  return r;
}

/** Documentos mínimos para reconstruir los totales de un turno desde cero (control cruzado). */
export interface OperacionesTurno {
  readonly ventas: readonly { turnoId: string; moneda: Moneda; pagos: readonly { medio: MedioPago; monto: number; cambio?: number }[] }[];
  readonly cobrosCredito: readonly { turnoId: string; moneda: Moneda; medio: MedioPago; monto: number }[];
  readonly movimientos: readonly { turnoId: string; moneda: Moneda; tipo: 'ingreso' | 'egreso'; monto: number }[];
  readonly anulaciones: readonly {
    turnoIdReembolso: string;
    moneda: Moneda;
    reembolsos: readonly { medio: MedioPago; monto: number }[];
    creditoCancelado: number;
  }[];
}

/** Reconstruye los totales del turno `turnoId` aplicando la fórmula de la especificación a las operaciones. */
export function reconstruirTotales(turnoId: string, ops: OperacionesTurno): TotalesTurno {
  let t: TotalesTurno = {};
  for (const v of ops.ventas) {
    if (v.turnoId !== turnoId) continue;
    for (const p of v.pagos) t = sumarTotales(t, v.moneda, deltaPorMedio(p.medio, p.monto - (p.cambio ?? 0)));
  }
  for (const c of ops.cobrosCredito) if (c.turnoId === turnoId) t = sumarTotales(t, c.moneda, deltaPorMedio(c.medio, c.monto));
  for (const m of ops.movimientos) {
    if (m.turnoId === turnoId) t = sumarTotales(t, m.moneda, m.tipo === 'ingreso' ? { ingresos: m.monto } : { egresos: m.monto });
  }
  for (const a of ops.anulaciones) {
    if (a.turnoIdReembolso !== turnoId) continue;
    for (const r of a.reembolsos) if (r.monto > 0) t = sumarTotales(t, a.moneda, deltaPorMedio(r.medio, -r.monto));
    if (a.creditoCancelado > 0) t = sumarTotales(t, a.moneda, { credito: -a.creditoCancelado });
  }
  return t;
}
