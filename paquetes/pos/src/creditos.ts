import { deltaPorMedio, sumarTotales } from './arqueo.js';
import { exigirOperarTurno } from './caja.js';
import { leerConfigPos } from './config.js';
import {
  ahoraDe, auditar, exigirActor, exigirCentavos, exigirTenant, exigirTexto, exigirUuid, leerObligatorio, rutaCobroCredito, rutaCredito, rutaTurno, type DepsPos,
} from './contexto.js';
import { ErrorPos } from './errores.js';
import { enteroDe, textoDe } from './lectura.js';
import type { ActorPos, MedioPago } from './tipos.js';
import { leerTurnoAbierto } from './turno.js';

export interface CobroCreditoEntrada {
  readonly medio: Exclude<MedioPago, 'credito'>;
  readonly monto: number;
  /** Obligatoria en QR (registro manual). */
  readonly referencia?: string;
}

export interface CobroCredito {
  readonly requestId: string;
  readonly ventaId: string;
  readonly turnoId: string;
  readonly moneda: string;
  readonly medio: Exclude<MedioPago, 'credito'>;
  readonly monto: number;
  readonly referencia?: string;
  readonly registradoPor: string;
  readonly creadoEnMs: number;
}

/**
 * Cobra (total o parcialmente) un crédito. El cobro entra al turno abierto en que se cobra:
 * en efectivo suma al efectivo esperado de esa moneda. Idempotente por `requestId`.
 */
export async function cobrarCredito(
  deps: DepsPos,
  tenantId: string,
  actor: ActorPos,
  requestIdEntrada: string,
  ventaIdEntrada: string,
  c: CobroCreditoEntrada,
): Promise<{ cobro: CobroCredito; repetido: boolean }> {
  exigirTenant(tenantId);
  exigirActor(actor);
  const requestId = exigirUuid(requestIdEntrada, 'requestId');
  const ventaId = exigirUuid(ventaIdEntrada, 'ventaId');
  if (c.medio !== 'efectivo' && c.medio !== 'qr' && c.medio !== 'transferencia') throw new ErrorPos('entrada-invalida', 'Medio de cobro inválido');
  const monto = exigirCentavos(c.monto, 'monto', 1);
  const referencia = c.referencia === undefined ? undefined : exigirTexto(c.referencia, 'referencia', 80);
  if (c.medio === 'qr' && referencia === undefined) throw new ErrorPos('pagos-invalidos', 'El cobro por QR exige la referencia registrada a mano');
  const ahora = ahoraDe(deps);
  return deps.db.runTransaction(async (tx) => {
    const previo = await leerObligatorio(tx, rutaCobroCredito(tenantId, requestId));
    if (previo !== undefined) {
      if (textoDe(previo, 'registradoPor') !== actor.uid || previo['ventaId'] !== ventaId) throw new ErrorPos('request-en-uso', 'Ese identificador ya se usó');
      return { cobro: previo as unknown as CobroCredito, repetido: true };
    }
    const credito = await leerObligatorio(tx, rutaCredito(tenantId, ventaId));
    if (credito === undefined) throw new ErrorPos('credito-inexistente', 'El crédito no existe');
    if (credito['estado'] !== 'pendiente') throw new ErrorPos('credito-inexistente', 'El crédito no tiene saldo pendiente');
    const saldo = enteroDe(credito, 'saldo');
    if (monto > saldo) throw new ErrorPos('credito-saldo-insuficiente', 'El cobro supera el saldo del crédito');
    const moneda = textoDe(credito, 'moneda') as 'BOB' | 'USD' | 'ARS';
    const config = await leerConfigPos(tx, tenantId);
    if (!config.mediosHabilitados.includes(c.medio)) throw new ErrorPos('medio-no-habilitado', `El medio ${c.medio} no está habilitado`);
    const abierto = await leerTurnoAbierto(tx, tenantId);
    if (abierto === undefined) throw new ErrorPos('sin-turno', 'No hay un turno abierto donde registrar el cobro');
    exigirOperarTurno(abierto.turno, actor);
    const cobro: CobroCredito = {
      requestId,
      ventaId,
      turnoId: abierto.turno.turnoId,
      moneda,
      medio: c.medio,
      monto,
      ...(referencia !== undefined ? { referencia } : {}),
      registradoPor: actor.uid,
      creadoEnMs: ahora,
    };
    tx.create(rutaCobroCredito(tenantId, requestId), { ...cobro, creadoEn: tx.marcaTiempoServidor() });
    const nuevoSaldo = saldo - monto;
    tx.set(rutaCredito(tenantId, ventaId), {
      ...credito,
      saldo: nuevoSaldo,
      cobrado: enteroDe(credito, 'cobrado') + monto,
      estado: nuevoSaldo === 0 ? 'cobrado' : 'pendiente',
    });
    const totales = sumarTotales(abierto.turno.totales, moneda, deltaPorMedio(c.medio, monto));
    tx.set(rutaTurno(tenantId, abierto.turno.turnoId), { ...abierto.raw, totales });
    auditar(tx, tenantId, actor, {
      accion: 'pos.credito.cobrar',
      ruta: rutaCobroCredito(tenantId, requestId),
      despues: { ventaId, turnoId: abierto.turno.turnoId, moneda, medio: c.medio, monto, saldo: nuevoSaldo },
    });
    return { cobro, repetido: false };
  });
}
