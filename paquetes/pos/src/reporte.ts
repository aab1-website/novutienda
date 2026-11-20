// «Mi reporte»: resumen del turno y paginación por cursor. Funciones puras: el borde lee los documentos y las llama.
import { ErrorPos } from './errores.js';
import { ordenarMonedas } from './lectura.js';
import { MEDIOS_PAGO, MONEDA_ISO, ORDEN_MONEDAS_POR_OMISION, type EstadoTurno, type MedioPago, type MontosPorMoneda, type TotalesTurno, type TurnoPos, type VentaPos } from './tipos.js';

/** Anulaciones que `resumenTurno` lee como máximo; si hay más, el resumen avisa con `truncado` (los reembolsos son parciales). */
export const MAX_DOCS_RESUMEN = 2000;
/** Filas por página de `misVentas` y `misTurnos`. */
export const FILAS_POR_PAGINA = 50;

type Datos = Readonly<Record<string, unknown>>;
const esObjeto = (x: unknown): x is Datos => typeof x === 'object' && x !== null && !Array.isArray(x);
const corrupto = (que: string): ErrorPos => new ErrorPos('dato-corrupto', `Documento inválido: ${que}`);
const entero = (x: unknown, que: string): number => {
  if (typeof x !== 'number' || !Number.isSafeInteger(x)) throw corrupto(que);
  return x;
};

/** Lo que el reporte usa de una anulación (`tenants/{t}/anulaciones/{ventaId}`). */
export interface AnulacionReporte {
  readonly turnoIdReembolso: string;
  readonly moneda: string;
  readonly reembolsos: readonly { readonly medio: MedioPago; readonly monto: number }[];
  readonly creditoCancelado: number;
}

export function leerAnulacion(d: Datos | undefined): AnulacionReporte {
  if (!esObjeto(d)) throw corrupto('anulación');
  const moneda = d['moneda'];
  const turnoIdReembolso = d['turnoIdReembolso'];
  if (typeof moneda !== 'string' || !MONEDA_ISO.test(moneda)) throw corrupto('moneda de la anulación');
  if (typeof turnoIdReembolso !== 'string' || turnoIdReembolso === '') throw corrupto('turnoIdReembolso');
  const lista = d['reembolsos'];
  if (!Array.isArray(lista)) throw corrupto('reembolsos');
  const reembolsos = lista.map((r: unknown) => {
    if (!esObjeto(r) || !MEDIOS_PAGO.includes(r['medio'] as MedioPago)) throw corrupto('reembolso');
    return { medio: r['medio'] as MedioPago, monto: entero(r['monto'], 'monto del reembolso') };
  });
  return { turnoIdReembolso, moneda, reembolsos, creditoCancelado: entero(d['creditoCancelado'], 'creditoCancelado') };
}

export interface MontosPorMedio {
  readonly efectivo: number;
  readonly qr: number;
  readonly transferencia: number;
  readonly credito: number;
}

/** Resumen de una moneda, en centavos. */
export interface ResumenMoneda {
  /** Ventas confirmadas del turno. */
  readonly ventas: number;
  /** Suma de subtotales de las ventas confirmadas, antes de descuentos. */
  readonly bruto: number;
  readonly descuentos: { readonly cantidad: number; readonly monto: number };
  /** Lo vendido: suma de totales de las ventas confirmadas. */
  readonly neto: number;
  /** Lo cobrado por medio, neto de cambio y de reembolsos (lo mismo que ve «Cierre de turno»). */
  readonly porMedio: MontosPorMedio;
  /** Ventas de este turno que ya se anularon. */
  readonly anuladas: { readonly cantidad: number; readonly monto: number };
  /** Lo devuelto en este turno por anulaciones (de ventas de este turno o de turnos anteriores); `credito` es el crédito cancelado. */
  readonly reembolsos: MontosPorMedio;
  readonly ingresos: number;
  readonly egresos: number;
}

export interface FilaTurno {
  readonly turnoId: string;
  readonly cajaId: string;
  readonly cajeroUid: string;
  readonly estado: EstadoTurno;
  readonly abiertoEnMs: number;
  readonly cerradoEnMs?: number;
  readonly apertura: MontosPorMoneda;
  readonly totales: TotalesTurno;
}

export interface ResumenTurno {
  readonly turno: FilaTurno;
  /** Monedas con movimiento, primero las declaradas por el comercio. */
  readonly monedas: readonly string[];
  readonly porMoneda: Readonly<Record<string, ResumenMoneda>>;
  /** Hay más anulaciones que el tope: los reembolsos son parciales (ventas, descuentos, anuladas y cobros por medio no). */
  readonly truncado: boolean;
}

const sinMedios = (): { efectivo: number; qr: number; transferencia: number; credito: number } => ({ efectivo: 0, qr: 0, transferencia: 0, credito: 0 });

/** Fila de un turno sin datos internos (carritos abiertos, quién lo cerró, motivos). */
export function filaTurno(t: TurnoPos): FilaTurno {
  return {
    turnoId: t.turnoId, cajaId: t.cajaId, cajeroUid: t.cajeroUid, estado: t.estado, abiertoEnMs: t.abiertoEnMs,
    ...(t.cerradoEnMs !== undefined ? { cerradoEnMs: t.cerradoEnMs } : {}), apertura: t.apertura, totales: t.totales,
  };
}

/** Lo que el servidor obtiene con agregaciones de Firestore (`count`/`sum`) de las ventas de un turno en una moneda. */
export interface AgregadoVentasMoneda {
  readonly confirmadas: { readonly cantidad: number; readonly subtotal: number; readonly total: number };
  /** Cantidad de confirmadas con descuento (`descuento.monto > 0`). */
  readonly conDescuento: number;
  readonly anuladas: { readonly cantidad: number; readonly total: number };
}

/** Agrega las ventas de un turno por moneda, igual que lo hacen las agregaciones del servidor. */
export function agregarVentas(turnoId: string, ventas: readonly VentaPos[]): Record<string, AgregadoVentasMoneda> {
  const acc: Record<string, { c: number; sub: number; tot: number; d: number; a: number; at: number }> = {};
  for (const v of ventas) {
    if (v.turnoId !== turnoId) continue;
    const x = (acc[v.moneda] ??= { c: 0, sub: 0, tot: 0, d: 0, a: 0, at: 0 });
    if (v.estado === 'anulada') {
      x.a += 1;
      x.at += v.total;
      continue;
    }
    x.c += 1;
    x.sub += v.subtotal;
    x.tot += v.total;
    if ((v.descuento?.monto ?? 0) > 0) x.d += 1;
  }
  const r: Record<string, AgregadoVentasMoneda> = {};
  for (const [m, x] of Object.entries(acc)) r[m] = { confirmadas: { cantidad: x.c, subtotal: x.sub, total: x.tot }, conDescuento: x.d, anuladas: { cantidad: x.a, total: x.at } };
  return r;
}

/**
 * Resumen del turno a partir de agregados de ventas por moneda y de las anulaciones que reembolsaron en él (acotadas al tope:
 * `truncado` lo dice y solo afecta a los reembolsos). Los cobros por medio, ingresos y egresos salen de `turno.totales`.
 * El monto de descuentos es bruto - neto (el neto siempre es subtotal menos descuento).
 */
export function resumirTurnoAgregado(
  turno: TurnoPos,
  agregados: Readonly<Record<string, AgregadoVentasMoneda>>,
  anulaciones: readonly AnulacionReporte[],
  truncado: boolean,
  declaradas: readonly string[] = ORDEN_MONEDAS_POR_OMISION,
): ResumenTurno {
  const reemb = new Map<string, ReturnType<typeof sinMedios>>();
  const reembDe = (m: string): ReturnType<typeof sinMedios> => {
    let x = reemb.get(m);
    if (x === undefined) {
      x = sinMedios();
      reemb.set(m, x);
    }
    return x;
  };
  for (const a of anulaciones) {
    if (a.turnoIdReembolso !== turno.turnoId) continue;
    const x = reembDe(a.moneda);
    for (const r of a.reembolsos) x[r.medio] += r.monto;
    x.credito += a.creditoCancelado;
  }
  const conMovimiento = Object.entries(agregados)
    .filter(([, g]) => g.confirmadas.cantidad > 0 || g.anuladas.cantidad > 0)
    .map(([m]) => m);
  const monedas = ordenarMonedas([...conMovimiento, ...reemb.keys(), ...Object.keys(turno.totales).filter((m) => turno.totales[m] !== undefined)], declaradas);
  const porMoneda: Record<string, ResumenMoneda> = {};
  for (const m of monedas) {
    const g = agregados[m];
    const t = turno.totales[m];
    const bruto = g?.confirmadas.subtotal ?? 0;
    const neto = g?.confirmadas.total ?? 0;
    porMoneda[m] = {
      ventas: g?.confirmadas.cantidad ?? 0, bruto, descuentos: { cantidad: g?.conDescuento ?? 0, monto: bruto - neto }, neto,
      porMedio: { efectivo: t?.efectivo ?? 0, qr: t?.qr ?? 0, transferencia: t?.transferencia ?? 0, credito: t?.credito ?? 0 },
      anuladas: { cantidad: g?.anuladas.cantidad ?? 0, monto: g?.anuladas.total ?? 0 }, reembolsos: reembDe(m), ingresos: t?.ingresos ?? 0, egresos: t?.egresos ?? 0,
    };
  }
  return { turno: filaTurno(turno), monedas, porMoneda, truncado };
}

/** Lo mismo que `resumirTurnoAgregado`, a partir de las ventas ya leídas (dobles y pruebas). */
export function resumirTurno(
  turno: TurnoPos,
  ventas: readonly VentaPos[],
  anulaciones: readonly AnulacionReporte[],
  truncado: boolean,
  declaradas: readonly string[] = ORDEN_MONEDAS_POR_OMISION,
): ResumenTurno {
  return resumirTurnoAgregado(turno, agregarVentas(turno.turnoId, ventas), anulaciones, truncado, declaradas);
}

/**
 * Paginación por cursor: se pide `limite + 1` documentos; si llegó el extra, hay más y el cursor es el de la última fila devuelta.
 */
export function paginar<T, C>(docs: readonly T[], limite: number, aCursor: (fila: T) => C): { readonly filas: readonly T[]; readonly siguiente: C | null } {
  if (docs.length <= limite) return { filas: docs, siguiente: null };
  const filas = docs.slice(0, limite);
  const ultima = filas[filas.length - 1];
  return { filas, siguiente: ultima === undefined ? null : aCursor(ultima) };
}
