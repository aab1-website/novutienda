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

export interface ReembolsoAnulacion {
  readonly medio: Exclude<MedioPago, 'credito'>;
  readonly moneda: VentaPos['moneda'];
  readonly monto: number;
}

export interface ResultadoAnulacion {
  readonly ventaId: string;
  /** Un reembolso por medio con que se cobró (efectivo, qr, transferencia); vacío si no se cobró nada. */
  readonly reembolsos: readonly ReembolsoAnulacion[];
  readonly turnoIdReembolso: string;
}

const MEDIOS_REEMBOLSABLES = ['efectivo', 'qr', 'transferencia'] as const;

/**
 * Lo realmente cobrado por medio: pagos sin crédito (netos de cambio) más cobros de crédito
 * (desglosados por medio en el propio crédito). Es el reembolso por los medios originales.
 */
function cobradoPorMedio(
  venta: VentaPos,
  credito: Readonly<Record<string, unknown>> | undefined,
): Record<(typeof MEDIOS_REEMBOLSABLES)[number], number> {
  const r = { efectivo: 0, qr: 0, transferencia: 0 };
  for (const p of venta.pagos) if (p.medio !== 'credito') r[p.medio] += p.monto - (p.cambio ?? 0);
  if (credito !== undefined) {
    const cobrado = enteroDe(credito, 'cobrado');
    const desglose = credito['cobradoPorMedio'];
    let suma = 0;
    if (cobrado > 0) {
      if (typeof desglose !== 'object' || desglose === null || Array.isArray(desglose)) {
        throw new ErrorPos('dato-corrupto', 'Falta el desglose por medio de los cobros del crédito');
      }
      for (const m of MEDIOS_REEMBOLSABLES) {
        const v = (desglose as Record<string, unknown>)[m];
        if (v === undefined) continue;
        if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw new ErrorPos('dato-corrupto', 'Desglose de cobros del crédito inválido');
        r[m] += v;
        suma += v;
      }
    }
    if (suma !== cobrado) throw new ErrorPos('dato-corrupto', 'El desglose de cobros del crédito no suma lo cobrado');
  }
  return r;
}

/**
 * Aprueba la anulación (solo `sup` o `adm`), una sola vez por venta: revierte stock y series por el
 * puerto de Inventarios, cancela el saldo de crédito, registra el reembolso en el TURNO ABIERTO y
 * publica `venta.anulada`. El reembolso es lo realmente cobrado y se devuelve por los medios con
 * que se cobró: el efectivo sale de la caja de esa moneda (se rechaza si no alcanza); QR y
 * transferencia se informan aparte y no tocan el efectivo.
 */
export async function aprobarAnulacion(
  deps: DepsPos,
  tenantId: string,
  actor: ActorPos,
  ventaIdEntrada: string,
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
    let credito: Readonly<Record<string, unknown>> | undefined;
    if (creditoPago !== undefined) {
      credito = await leerObligatorio(tx, rutaCredito(tenantId, ventaId));
      if (credito === undefined) throw new ErrorPos('dato-corrupto', 'Falta el crédito de la venta');
    }
    const porMedio = cobradoPorMedio(venta, credito);
    const reembolsos: ReembolsoAnulacion[] = MEDIOS_REEMBOLSABLES.filter((m) => porMedio[m] > 0).map((m) => ({
      medio: m,
      moneda: venta.moneda,
      monto: porMedio[m],
    }));
    if (porMedio.efectivo > efectivoDisponible(abierto.turno, venta.moneda)) {
      throw new ErrorPos('egreso-excede-efectivo', 'El reembolso en efectivo supera el efectivo de esa moneda en la caja');
    }
    const monto = reembolsos.reduce((s, r) => s + r.monto, 0);
    const ref = { tipo: 'venta' as const, id: ventaId };
    const por = { uid: actor.uid, rol: actor.rol };
    const plan = await deps.inventarios.prepararReversion(tx, tenantId, ref);

    // Escrituras.
    deps.inventarios.aplicarReversion(tx, plan, ref, por);
    let totales: TotalesTurno = abierto.turno.totales;
    for (const r of reembolsos) totales = sumarTotales(totales, venta.moneda, deltaPorMedio(r.medio, -r.monto));
    if (creditoPago !== undefined) totales = sumarTotales(totales, venta.moneda, { credito: -creditoPago.monto });
    tx.set(rutaTurno(tenantId, abierto.turno.turnoId), { ...abierto.raw, totales });
    if (credito !== undefined) tx.set(rutaCredito(tenantId, ventaId), { ...credito, estado: 'anulado', saldo: 0 });
    tx.set(rutaVenta(tenantId, ventaId), { ...raw, estado: 'anulada', anuladaEnMs: ahora });
    tx.create(rutaAnulacion(tenantId, ventaId), {
      ventaId,
      turnoId: venta.turnoId,
      turnoIdReembolso: abierto.turno.turnoId,
      moneda: venta.moneda,
      motivo: venta.solicitudAnulacion.motivo,
      solicitadoPor: venta.solicitudAnulacion.por,
      aprobadoPor: actor.uid,
      reembolsos,
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
        reembolsos,
        turnoIdReembolso: abierto.turno.turnoId,
      },
    });
    auditar(tx, tenantId, actor, {
      accion: 'pos.anulacion.aprobar',
      ruta: rutaAnulacion(tenantId, ventaId),
      antes: { estado: 'confirmada' },
      despues: { estado: 'anulada', reembolso: monto, medios: reembolsos.map((r) => r.medio) },
      motivo: venta.solicitudAnulacion.motivo,
    });
    return { ventaId, reembolsos, turnoIdReembolso: abierto.turno.turnoId };
  });
}
