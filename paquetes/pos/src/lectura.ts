import type { Moneda } from '@novutienda/nucleo';
import { ErrorPos } from './errores.js';
import { MONEDAS_POS, type MontosPorMoneda, type TotalesMoneda, type TotalesTurno, type TurnoPos, type VentaPos } from './tipos.js';

type Datos = Readonly<Record<string, unknown>>;

const corrupto = (que: string): ErrorPos => new ErrorPos('dato-corrupto', `Documento inválido: ${que}`);
const esObjeto = (x: unknown): x is Datos => typeof x === 'object' && x !== null && !Array.isArray(x);
const entero = (x: unknown, que: string): number => {
  if (typeof x !== 'number' || !Number.isSafeInteger(x)) throw corrupto(que);
  return x;
};
const texto = (x: unknown, que: string): string => {
  if (typeof x !== 'string' || x === '') throw corrupto(que);
  return x;
};

function montos(x: unknown, que: string): MontosPorMoneda {
  if (!esObjeto(x)) throw corrupto(que);
  const r: Partial<Record<Moneda, number>> = {};
  for (const m of MONEDAS_POS) if (x[m] !== undefined) r[m] = entero(x[m], `${que}.${m}`);
  return r;
}

function totales(x: unknown): TotalesTurno {
  if (!esObjeto(x)) throw corrupto('totales');
  const r: Partial<Record<Moneda, TotalesMoneda>> = {};
  for (const m of MONEDAS_POS) {
    const t = x[m];
    if (t === undefined) continue;
    if (!esObjeto(t)) throw corrupto(`totales.${m}`);
    r[m] = {
      efectivo: entero(t['efectivo'], 'efectivo'),
      qr: entero(t['qr'], 'qr'),
      transferencia: entero(t['transferencia'], 'transferencia'),
      credito: entero(t['credito'], 'credito'),
      ingresos: entero(t['ingresos'], 'ingresos'),
      egresos: entero(t['egresos'], 'egresos'),
    };
  }
  return r;
}

export function leerTurno(d: Datos | undefined): TurnoPos {
  if (!esObjeto(d)) throw corrupto('turno');
  const estado = d['estado'];
  if (estado !== 'abierto' && estado !== 'cerrado' && estado !== 'cerrado_forzado') throw corrupto('estado del turno');
  return {
    turnoId: texto(d['turnoId'], 'turnoId'),
    cajaId: texto(d['cajaId'], 'cajaId'),
    cajeroUid: texto(d['cajeroUid'], 'cajeroUid'),
    estado,
    apertura: montos(d['apertura'], 'apertura'),
    totales: totales(d['totales']),
    abiertoEnMs: entero(d['abiertoEnMs'], 'abiertoEnMs'),
  };
}

/** La venta se guarda con la forma de `VentaPos`; aquí se comprueba lo que usan anulación y cobro. */
export function leerVenta(d: Datos | undefined): VentaPos {
  if (!esObjeto(d)) throw corrupto('venta');
  const estado = d['estado'];
  if (estado !== 'confirmada' && estado !== 'anulada') throw corrupto('estado de la venta');
  texto(d['ventaId'], 'ventaId');
  texto(d['turnoId'], 'turnoId');
  texto(d['cajeroUid'], 'cajeroUid');
  entero(d['total'], 'total');
  if (!MONEDAS_POS.includes(d['moneda'] as Moneda)) throw corrupto('moneda');
  if (!Array.isArray(d['lineas']) || !Array.isArray(d['pagos'])) throw corrupto('líneas o pagos');
  return d as unknown as VentaPos;
}

export function enteroDe(d: Datos, campo: string): number {
  return entero(d[campo], campo);
}
export function textoDe(d: Datos, campo: string): string {
  return texto(d[campo], campo);
}
