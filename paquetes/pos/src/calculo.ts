import type { Moneda } from '@novutienda/nucleo';
import { ErrorPos } from './errores.js';
import { MEDIOS_PAGO, MONEDAS_POS, type ActorPos, type MedioPago, type PagoVentaPos } from './tipos.js';

/** Tope práctico de una venta (centavos): mantiene toda la aritmética dentro de los enteros seguros. */
export const TOTAL_MAXIMO = 100_000_000_000;

const pagoInvalido = (m: string): ErrorPos => new ErrorPos('pagos-invalidos', m);

/** Un descuento supera el tope si monto / subtotal > topeBp / 10000 (aritmética entera). */
export const descuentoExcedeTope = (subtotal: number, monto: number, topeBp: number): boolean => monto * 10000 > topeBp * subtotal;

export interface ContextoPagos {
  readonly moneda: Moneda;
  readonly total: number;
  readonly medios: readonly MedioPago[];
  readonly actor: ActorPos;
}

/**
 * Valida y normaliza los pagos de una venta: una sola moneda (la de la venta), medios habilitados,
 * cambio solo en efectivo, QR con referencia (se guarda «registrado por», nunca verificado) y
 * suma de pagos − cambio = total.
 */
export function validarPagos(pagos: unknown, ctx: ContextoPagos): PagoVentaPos[] {
  if (!Array.isArray(pagos) || pagos.length === 0 || pagos.length > 10) throw pagoInvalido('Indique entre 1 y 10 pagos');
  let neto = 0;
  let creditos = 0;
  const salida: PagoVentaPos[] = [];
  for (const p of pagos as unknown[]) {
    if (typeof p !== 'object' || p === null) throw pagoInvalido('Pago inválido');
    const o = p as Record<string, unknown>;
    for (const k of Object.keys(o)) if (!['medio', 'moneda', 'monto', 'cambio', 'referencia'].includes(k)) throw pagoInvalido(`Campo no admitido en el pago: ${k}`);
    const medio = o['medio'] as MedioPago;
    if (!MEDIOS_PAGO.includes(medio)) throw pagoInvalido('Medio de pago desconocido');
    if (!ctx.medios.includes(medio)) throw new ErrorPos('medio-no-habilitado', `El medio ${medio} no está habilitado`);
    const moneda = o['moneda'] as Moneda;
    if (!MONEDAS_POS.includes(moneda) || moneda !== ctx.moneda) throw pagoInvalido(`Todos los pagos deben ser en ${ctx.moneda}, la moneda de la venta`);
    const monto = o['monto'];
    if (typeof monto !== 'number' || !Number.isSafeInteger(monto) || monto < 1) throw pagoInvalido('El monto del pago debe ser un entero de centavos positivo');
    const cambioEntrada = o['cambio'];
    let cambio = 0;
    if (cambioEntrada !== undefined) {
      if (typeof cambioEntrada !== 'number' || !Number.isSafeInteger(cambioEntrada) || cambioEntrada < 0) throw pagoInvalido('El cambio debe ser un entero de centavos no negativo');
      cambio = cambioEntrada;
    }
    if (cambio > 0 && medio !== 'efectivo') throw pagoInvalido('Solo el efectivo admite cambio');
    if (cambio > monto) throw pagoInvalido('El cambio no puede superar el monto recibido');
    const refEntrada = o['referencia'];
    let referencia: string | undefined;
    if (refEntrada !== undefined) {
      if (typeof refEntrada !== 'string' || refEntrada.trim() === '' || refEntrada.length > 80) throw pagoInvalido('La referencia debe ser texto de hasta 80 caracteres');
      referencia = refEntrada.trim();
    }
    if (medio === 'qr' && referencia === undefined) throw pagoInvalido('El pago por QR exige la referencia registrada a mano');
    if (medio === 'credito') creditos += 1;
    neto += monto - cambio;
    salida.push({
      medio,
      moneda,
      monto,
      ...(cambio > 0 ? { cambio } : {}),
      ...(referencia !== undefined ? { referencia } : {}),
      ...(medio === 'qr' ? { registradoPor: ctx.actor.uid } : {}),
    });
  }
  if (creditos > 1) throw pagoInvalido('Solo puede haber un pago a crédito');
  if (neto !== ctx.total) throw pagoInvalido('La suma de los pagos menos el cambio no coincide con el total');
  return salida;
}
