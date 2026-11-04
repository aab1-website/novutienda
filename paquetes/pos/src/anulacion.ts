import { deltaPorMedio, efectivoDisponible, sumarTotales } from './arqueo.js';
import {
  ahoraDe, auditar, exigirActor, exigirRol, exigirTenant, exigirTexto, exigirUuid, leerObligatorio, publicar,
  rutaAnulacion, rutaCredito, rutaTurno, rutaVenta, type DepsPos,
} from './contexto.js';
import { ErrorPos } from './errores.js';
import { enteroDe, leerVenta } from './lectura.js';
import type { ActorPos, MedioPago, TotalesTurno, VentaPos } from './tipos.js';
import { leerTurnoAbierto } from './turno.js';

/**
 * El vendedor solicita la anulación de una venta confirmada (con motivo). No cambia nada más:
 * la aprueba un supervisor o administrador. Un cajero solo solicita sobre sus propias ventas.
 */
export async function solicitarAnulacion(
  deps: DepsPos,
  tenantId: string,
  actor: ActorPos,
  ventaIdEntrada: string,
  motivoEntrada: string,
): Promise<VentaPos> {
  exigirTenant(tenantId);
  exigirActor(actor);
  const ventaId = exigirUuid(ventaIdEntrada, 'ventaId');
  const motivo = exigirTexto(motivoEntrada, 'motivo');
  const ahora = ahoraDe(deps);
  return deps.db.runTransaction(async (tx) => {
    const raw = await leerObligatorio(tx, rutaVenta(tenantId, ventaId));
    if (raw === undefined) throw new ErrorPos('venta-inexistente', 'La venta no existe');
    const venta = leerVenta(raw);
    if (venta.estado === 'anulada') throw new ErrorPos('venta-ya-anulada', 'La venta ya está anulada');
    if (actor.rol === 'caj' && venta.cajeroUid !== actor.uid) throw new ErrorPos('no-autorizado', 'Solo puede solicitar la anulación de sus propias ventas');
    if (venta.solicitudAnulacion !== undefined) return venta;
    const solicitudAnulacion = { por: actor.uid, motivo, enMs: ahora };
    tx.set(rutaVenta(tenantId, ventaId), { ...raw, solicitudAnulacion });
    auditar(tx, tenantId, actor, { accion: 'pos.anulacion.solicitar', ruta: rutaVenta(tenantId, ventaId), despues: { ventaId }, motivo });
    return { ...venta, solicitudAnulacion };
  });
}

export interface ResultadoAnulacion {
  readonly ventaId: string;
  readonly reembolso: { readonly medio: MedioPago; readonly moneda: VentaPos['moneda']; readonly monto: number };
  readonly turnoIdReembolso: string;
}

/**
 * Aprueba la anulación (solo `sup` o `adm`), una sola vez por venta: revierte stock y series por el
 * puerto de Inventarios, cancela el saldo de crédito, registra el reembolso en el TURNO ABIERTO y
 * publica `venta.anulada`. El reembolso es lo realmente cobrado (pagos sin crédito más cobros de
 * crédito); `medioReembolso` es obligatorio si ese monto es mayor que cero.
 */
export async function aprobarAnulacion(
  deps: DepsPos,
  tenantId: string,
  actor: ActorPos,
  ventaIdEntrada: string,
  medioReembolso?: MedioPago,
): Promise<ResultadoAnulacion> {
  exigirTenant(tenantId);
  exigirActor(actor);
  exigirRol(actor, ['sup', 'adm'], 'aprobar anulaciones');
  const ventaId = exigirUuid(ventaIdEntrada, 'ventaId');
  const ahora = ahoraDe(deps);
  return deps.db.runTransaction(async (tx) => {
    const raw = await leerObligatorio(tx, rutaVenta(tenantId, ventaId));
    if (raw === undefined) throw new ErrorPos('venta-inexistente', 'La venta no existe');
    const venta = leerVenta(raw);
    // Una venta no se anula dos veces: el estado lo impide y `create` de la anulación es el respaldo.
    if (venta.estado === 'anulada' || (await tx.get(rutaAnulacion(tenantId, ventaId))).existe) {
      throw new ErrorPos('venta-ya-anulada', 'La venta ya está anulada');
    }
    if (venta.solicitudAnulacion === undefined) throw new ErrorPos('anulacion-sin-solicitud', 'El vendedor debe solicitar la anulación primero');
    const abierto = await leerTurnoAbierto(tx, tenantId);
    if (abierto === undefined) throw new ErrorPos('sin-turno', 'No hay un turno abierto donde registrar el reembolso');
    const creditoPago = venta.pagos.find((p) => p.medio === 'credito');
    let cobrado = 0;
    let credito: Readonly<Record<string, unknown>> | undefined;
    if (creditoPago !== undefined) {
      credito = await leerObligatorio(tx, rutaCredito(tenantId, ventaId));
      if (credito === undefined) throw new ErrorPos('dato-corrupto', 'Falta el crédito de la venta');
      cobrado = enteroDe(credito, 'cobrado');
    }
    const sinCredito = venta.pagos.filter((p) => p.medio !== 'credito').reduce((s, p) => s + p.monto - (p.cambio ?? 0), 0);
    const monto = sinCredito + cobrado;
    const medio: MedioPago = monto === 0 ? 'credito' : (medioReembolso ?? 'credito');
    if (monto > 0 && (medio === 'credito' || !['efectivo', 'qr', 'transferencia'].includes(medio))) {
      throw new ErrorPos('entrada-invalida', 'Indique el medio del reembolso: efectivo, qr o transferencia');
    }
    if (medio === 'efectivo' && monto > efectivoDisponible(abierto.turno, venta.moneda)) {
      throw new ErrorPos('egreso-excede-efectivo', 'El reembolso en efectivo supera el efectivo de esa moneda en la caja');
    }
    const ref = { tipo: 'venta' as const, id: ventaId };
    const por = { uid: actor.uid, rol: actor.rol };
    const plan = await deps.inventarios.prepararReversion(tx, tenantId, ref);

    // Escrituras.
    deps.inventarios.aplicarReversion(tx, plan, ref, por);
    let totales: TotalesTurno = abierto.turno.totales;
    if (monto > 0) totales = sumarTotales(totales, venta.moneda, deltaPorMedio(medio, -monto));
    if (creditoPago !== undefined) totales = sumarTotales(totales, venta.moneda, { credito: -creditoPago.monto });
    tx.set(rutaTurno(tenantId, abierto.turno.turnoId), { ...abierto.raw, totales });
    if (credito !== undefined) tx.set(rutaCredito(tenantId, ventaId), { ...credito, estado: 'anulado', saldo: 0 });
    tx.set(rutaVenta(tenantId, ventaId), { ...raw, estado: 'anulada', anuladaEnMs: ahora });
    const reembolso = { medio, moneda: venta.moneda, monto };
    tx.create(rutaAnulacion(tenantId, ventaId), {
      ventaId,
      turnoId: venta.turnoId,
      turnoIdReembolso: abierto.turno.turnoId,
      moneda: venta.moneda,
      motivo: venta.solicitudAnulacion.motivo,
      solicitadoPor: venta.solicitudAnulacion.por,
      aprobadoPor: actor.uid,
      reembolso,
      creditoCancelado: creditoPago?.monto ?? 0,
      creadoEnMs: ahora,
      creadoEn: tx.marcaTiempoServidor(),
    });
    publicar(tx, {
      tenantId,
      tipo: 'venta.anulada',
      clave: `venta-anulada.${ventaId}`,
      ocurridoEnMs: ahora,
      datos: {
        ventaId,
        turnoId: venta.turnoId,
        motivo: venta.solicitudAnulacion.motivo,
        anuladaPor: venta.solicitudAnulacion.por,
        aprobadoPor: actor.uid,
        lineas: venta.lineas.map((l) => ({ productoId: l.productoId, cantidad: l.cantidad, almacenId: l.almacenId, series: l.series })),
        reembolso,
        turnoIdReembolso: abierto.turno.turnoId,
      },
    });
    auditar(tx, tenantId, actor, {
      accion: 'pos.anulacion.aprobar',
      ruta: rutaAnulacion(tenantId, ventaId),
      antes: { estado: 'confirmada' },
      despues: { estado: 'anulada', reembolso: monto, medio },
      motivo: venta.solicitudAnulacion.motivo,
    });
    return { ventaId, reembolso, turnoIdReembolso: abierto.turno.turnoId };
  });
}
