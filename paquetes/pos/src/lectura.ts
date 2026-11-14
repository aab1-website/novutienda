import { ErrorPos } from './errores.js';
import { ORDEN_MONEDAS_POR_OMISION, type MontosPorMoneda, type TotalesMoneda, type TotalesTurno, type TurnoPos, type VentaPos } from './tipos.js';

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

const MONEDA_ISO = /^[A-Z]{3}$/;

/**
 * Ordena códigos de moneda: primero los declarados (en su orden) y después el resto, ordenado.
 * Una venta o un turno viejos pueden traer una moneda que el comercio ya no declara: se leen igual.
 */
export function ordenarMonedas(presentes: Iterable<string>, declaradas: readonly string[] = ORDEN_MONEDAS_POR_OMISION): string[] {
  const set = new Set(presentes);
  return [...declaradas.filter((m) => set.has(m)), ...[...set].filter((m) => !declaradas.includes(m)).sort()];
}

/** Claves de moneda de un objeto guardado: cualquier código ISO de tres letras mayúsculas; otra cosa es dato corrupto. */
function clavesMoneda(x: Datos, que: string, declaradas: readonly string[]): string[] {
  const claves = Object.keys(x).filter((k) => x[k] !== undefined);
  for (const k of claves) if (!MONEDA_ISO.test(k)) throw corrupto(`${que}: moneda «${k}»`);
  return ordenarMonedas(claves, declaradas);
}

function montos(x: unknown, que: string, declaradas: readonly string[]): MontosPorMoneda {
  if (!esObjeto(x)) throw corrupto(que);
  const r: Record<string, number> = {};
  for (const m of clavesMoneda(x, que, declaradas)) r[m] = entero(x[m], `${que}.${m}`);
  return r;
}

function totales(x: unknown, declaradas: readonly string[]): TotalesTurno {
  if (!esObjeto(x)) throw corrupto('totales');
  const r: Record<string, TotalesMoneda> = {};
  for (const m of clavesMoneda(x, 'totales', declaradas)) {
    const t = x[m];
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

/** `declaradas`: monedas del comercio, para ordenar las claves; por omisión, el orden del tenant de referencia. */
export function leerTurno(d: Datos | undefined, declaradas: readonly string[] = ORDEN_MONEDAS_POR_OMISION): TurnoPos {
  if (!esObjeto(d)) throw corrupto('turno');
  const estado = d['estado'];
  if (estado !== 'abierto' && estado !== 'cerrado' && estado !== 'cerrado_forzado') throw corrupto('estado del turno');
  return {
    turnoId: texto(d['turnoId'], 'turnoId'),
    cajaId: texto(d['cajaId'], 'cajaId'),
    cajeroUid: texto(d['cajeroUid'], 'cajeroUid'),
    estado,
    apertura: montos(d['apertura'], 'apertura', declaradas),
    totales: totales(d['totales'], declaradas),
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
  if (typeof d['moneda'] !== 'string' || !MONEDA_ISO.test(d['moneda'])) throw corrupto('moneda');
  if (!Array.isArray(d['lineas']) || !Array.isArray(d['pagos'])) throw corrupto('líneas o pagos');
  return d as unknown as VentaPos;
}

export function enteroDe(d: Datos, campo: string): number {
  return entero(d[campo], campo);
}
export function textoDe(d: Datos, campo: string): string {
  return texto(d[campo], campo);
}
