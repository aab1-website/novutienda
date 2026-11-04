import type { Moneda } from '@plataforma/nucleo';
import { efectivoDisponible, sumarTotales } from './arqueo.js';
import {
  ahoraDe, auditar, exigirActor, exigirCentavos, exigirTenant, exigirTexto, exigirUuid, leerObligatorio, rutaMovimiento, rutaTurno, type DepsPos,
} from './contexto.js';
import { ErrorPos } from './errores.js';
import { textoDe } from './lectura.js';
import { MONEDAS_POS, type ActorPos, type TurnoPos } from './tipos.js';
import { leerTurnoAbierto } from './turno.js';

export interface MovimientoCajaEntrada {
  readonly tipo: 'ingreso' | 'egreso';
  readonly moneda: Moneda;
  readonly monto: number;
  readonly motivo: string;
  readonly comprobante?: string;
}

export interface MovimientoCaja {
  readonly requestId: string;
  readonly tipo: 'ingreso' | 'egreso';
  readonly moneda: Moneda;
  readonly monto: number;
  readonly motivo: string;
  readonly comprobante?: string;
  readonly turnoId: string;
  readonly registradoPor: string;
  readonly creadoEnMs: number;
}

/** Quien puede operar sobre el turno abierto: su cajero o un supervisor/administrador. */
export function exigirOperarTurno(turno: TurnoPos, actor: ActorPos): void {
  if (turno.cajeroUid !== actor.uid && actor.rol === 'caj') throw new ErrorPos('turno-ajeno', 'El turno abierto es de otro usuario');
}

/**
 * Ingreso o egreso de caja, siempre con motivo, en el turno abierto. Idempotente por `requestId`.
 * Un egreso mayor al efectivo de esa moneda se rechaza en el servidor.
 */
export async function registrarMovimientoCaja(
  deps: DepsPos,
  tenantId: string,
  actor: ActorPos,
  requestIdEntrada: string,
  m: MovimientoCajaEntrada,
): Promise<{ movimiento: MovimientoCaja; repetido: boolean }> {
  exigirTenant(tenantId);
  exigirActor(actor);
  const requestId = exigirUuid(requestIdEntrada, 'requestId');
  if (m.tipo !== 'ingreso' && m.tipo !== 'egreso') throw new ErrorPos('entrada-invalida', 'tipo debe ser ingreso o egreso');
  if (!MONEDAS_POS.includes(m.moneda)) throw new ErrorPos('entrada-invalida', 'moneda inválida');
  const monto = exigirCentavos(m.monto, 'monto', 1);
  const motivo = exigirTexto(m.motivo, 'El motivo');
  const comprobante = m.comprobante === undefined ? undefined : exigirTexto(m.comprobante, 'comprobante', 100);
  const ahora = ahoraDe(deps);
  return deps.db.runTransaction(async (tx) => {
    const previo = await leerObligatorio(tx, rutaMovimiento(tenantId, requestId));
    if (previo !== undefined) {
      if (textoDe(previo, 'registradoPor') !== actor.uid) throw new ErrorPos('request-en-uso', 'Ese identificador ya se usó');
      return { movimiento: previo as unknown as MovimientoCaja, repetido: true };
    }
    const abierto = await leerTurnoAbierto(tx, tenantId);
    if (abierto === undefined) throw new ErrorPos('sin-turno', 'No hay un turno abierto');
    exigirOperarTurno(abierto.turno, actor);
    if (m.tipo === 'egreso' && monto > efectivoDisponible(abierto.turno, m.moneda)) {
      throw new ErrorPos('egreso-excede-efectivo', `El egreso supera el efectivo disponible en ${m.moneda}`);
    }
    const movimiento: MovimientoCaja = {
      requestId,
      tipo: m.tipo,
      moneda: m.moneda,
      monto,
      motivo,
      ...(comprobante !== undefined ? { comprobante } : {}),
      turnoId: abierto.turno.turnoId,
      registradoPor: actor.uid,
      creadoEnMs: ahora,
    };
    tx.set(rutaMovimiento(tenantId, requestId), { ...movimiento, creadoEn: tx.marcaTiempoServidor() });
    const totales = sumarTotales(abierto.turno.totales, m.moneda, m.tipo === 'ingreso' ? { ingresos: monto } : { egresos: monto });
    tx.set(rutaTurno(tenantId, abierto.turno.turnoId), { ...abierto.raw, totales });
    auditar(tx, tenantId, actor, {
      accion: m.tipo === 'ingreso' ? 'pos.caja.ingreso' : 'pos.caja.egreso',
      ruta: rutaMovimiento(tenantId, requestId),
      despues: { turnoId: abierto.turno.turnoId, moneda: m.moneda, monto },
      motivo,
    });
    return { movimiento, repetido: false };
  });
}
