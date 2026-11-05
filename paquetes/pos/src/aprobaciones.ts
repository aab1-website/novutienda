import type { Moneda, TransaccionIdentidad } from '@novutienda/nucleo';
import {
  VIGENCIA_APROBACION_POR_DEFECTO_MS, ahoraDe, auditar, exigirActor, exigirCentavos, exigirRol, exigirTenant, exigirTexto, exigirUuid,
  leerObligatorio, rutaAprobacion, type DepsPos,
} from './contexto.js';
import { ErrorPos } from './errores.js';
import { enteroDe, textoDe } from './lectura.js';
import { MONEDAS_POS, type ActorPos } from './tipos.js';

export type TipoAprobacion = 'descuento' | 'credito';
export type EstadoAprobacion = 'pendiente' | 'aprobada' | 'rechazada' | 'usada';

/** `aprobaciones_descuento/{id}`: de un solo uso, nunca autoaprobada. El crédito usa el mismo mecanismo (`tipo`). */
export interface AprobacionPos {
  readonly aprobacionId: string;
  readonly tipo: TipoAprobacion;
  readonly estado: EstadoAprobacion;
  readonly moneda: Moneda;
  /** Tope aprobado en centavos (descuento máximo o crédito máximo). */
  readonly monto: number;
  readonly motivo: string;
  readonly deudor?: string;
  readonly solicitadoPor: string;
  readonly solicitadoEnMs: number;
  readonly aprobadoPor?: string;
  readonly aprobadoRol?: string;
  readonly resueltoEnMs?: number;
  readonly venceEnMs?: number;
  readonly usadaEnVenta?: string;
}

export interface SolicitudAprobacion {
  readonly tipo: TipoAprobacion;
  readonly moneda: Moneda;
  readonly monto: number;
  readonly motivo: string;
  readonly deudor?: string;
}

/** Cualquier usuario autenticado del tenant solicita; la solicitud queda pendiente. Idempotente por `aprobacionId`. */
export async function solicitarAprobacion(
  deps: DepsPos,
  tenantId: string,
  actor: ActorPos,
  aprobacionIdEntrada: string,
  s: SolicitudAprobacion,
): Promise<AprobacionPos> {
  exigirTenant(tenantId);
  exigirActor(actor);
  const aprobacionId = exigirUuid(aprobacionIdEntrada, 'aprobacionId');
  if (s.tipo !== 'descuento' && s.tipo !== 'credito') throw new ErrorPos('entrada-invalida', 'tipo de aprobación inválido');
  if (!MONEDAS_POS.includes(s.moneda)) throw new ErrorPos('entrada-invalida', 'moneda inválida');
  const monto = exigirCentavos(s.monto, 'monto', 1);
  const motivo = exigirTexto(s.motivo, 'motivo');
  const deudor = s.tipo === 'credito' ? exigirTexto(s.deudor, 'deudor', 100) : undefined;
  const ahora = ahoraDe(deps);
  return deps.db.runTransaction(async (tx) => {
    const previa = await leerObligatorio(tx, rutaAprobacion(tenantId, aprobacionId));
    if (previa !== undefined) {
      if (previa['solicitadoPor'] !== actor.uid) throw new ErrorPos('request-en-uso', 'Ese identificador ya se usó');
      return previa as unknown as AprobacionPos;
    }
    const doc: AprobacionPos = {
      aprobacionId,
      tipo: s.tipo,
      estado: 'pendiente',
      moneda: s.moneda,
      monto,
      motivo,
      ...(deudor !== undefined ? { deudor } : {}),
      solicitadoPor: actor.uid,
      solicitadoEnMs: ahora,
    };
    tx.set(rutaAprobacion(tenantId, aprobacionId), doc as unknown as Record<string, unknown>);
    auditar(tx, tenantId, actor, {
      accion: 'pos.aprobacion.solicitar',
      ruta: rutaAprobacion(tenantId, aprobacionId),
      despues: { tipo: s.tipo, moneda: s.moneda, monto },
      motivo,
    });
    return doc;
  });
}

/** Aprueba o rechaza (solo `sup` o `adm`, nunca quien la solicitó). La aprobación vence y se usa una sola vez. */
export async function resolverAprobacion(
  deps: DepsPos,
  tenantId: string,
  actor: ActorPos,
  aprobacionIdEntrada: string,
  decision: 'aprobar' | 'rechazar',
): Promise<AprobacionPos> {
  exigirTenant(tenantId);
  exigirActor(actor);
  exigirRol(actor, ['sup', 'adm'], 'resolver aprobaciones');
  const aprobacionId = exigirUuid(aprobacionIdEntrada, 'aprobacionId');
  if (decision !== 'aprobar' && decision !== 'rechazar') throw new ErrorPos('entrada-invalida', 'decisión inválida');
  const ahora = ahoraDe(deps);
  const vigencia = deps.vigenciaAprobacionMs ?? VIGENCIA_APROBACION_POR_DEFECTO_MS;
  return deps.db.runTransaction(async (tx) => {
    const raw = await leerObligatorio(tx, rutaAprobacion(tenantId, aprobacionId));
    if (raw === undefined) throw new ErrorPos('aprobacion-inexistente', 'La solicitud no existe');
    if (textoDe(raw, 'solicitadoPor') === actor.uid) throw new ErrorPos('autoaprobacion', 'Nadie puede resolver su propia solicitud');
    if (raw['estado'] !== 'pendiente') throw new ErrorPos('aprobacion-usada', 'La solicitud ya fue resuelta');
    const nueva =
      decision === 'aprobar'
        ? { ...raw, estado: 'aprobada', aprobadoPor: actor.uid, aprobadoRol: actor.rol, resueltoEnMs: ahora, venceEnMs: ahora + vigencia }
        : { ...raw, estado: 'rechazada', aprobadoPor: actor.uid, aprobadoRol: actor.rol, resueltoEnMs: ahora };
    tx.set(rutaAprobacion(tenantId, aprobacionId), nueva);
    auditar(tx, tenantId, actor, {
      accion: decision === 'aprobar' ? 'pos.aprobacion.aprobar' : 'pos.aprobacion.rechazar',
      ruta: rutaAprobacion(tenantId, aprobacionId),
      antes: { estado: 'pendiente' },
      despues: { estado: nueva.estado },
    });
    return nueva as unknown as AprobacionPos;
  });
}

export interface UsoEsperado {
  readonly tipo: TipoAprobacion;
  readonly moneda: Moneda;
  readonly monto: number;
  readonly deudor?: string;
}

export interface AprobacionLeida {
  readonly raw: Readonly<Record<string, unknown>>;
  readonly aprobadoPor: string;
}

/**
 * LECTURA y validación de una aprobación para usarla en una venta. Rechaza: inexistente, no aprobada,
 * ya usada, vencida, de otro solicitante, autoaprobada, de otro tipo, otra moneda o por un monto menor.
 */
export async function leerAprobacionParaUso(
  tx: TransaccionIdentidad,
  tenantId: string,
  aprobacionId: string,
  actor: ActorPos,
  ahora: number,
  esperado: UsoEsperado,
): Promise<AprobacionLeida> {
  const raw = await leerObligatorio(tx, rutaAprobacion(tenantId, exigirUuid(aprobacionId, 'aprobacionId')));
  if (raw === undefined) throw new ErrorPos('aprobacion-inexistente', 'La aprobación no existe');
  if (raw['estado'] === 'usada') throw new ErrorPos('aprobacion-usada', 'La aprobación ya se usó');
  if (raw['estado'] !== 'aprobada') throw new ErrorPos('aprobacion-no-aprobada', 'La aprobación no está aprobada');
  const aprobadoPor = textoDe(raw, 'aprobadoPor');
  if (aprobadoPor === textoDe(raw, 'solicitadoPor') || (raw['aprobadoRol'] !== 'sup' && raw['aprobadoRol'] !== 'adm')) {
    throw new ErrorPos('autoaprobacion', 'La aprobación no la dio un supervisor o administrador distinto de quien la pidió');
  }
  if (enteroDe(raw, 'venceEnMs') <= ahora) throw new ErrorPos('aprobacion-vencida', 'La aprobación venció');
  if (raw['solicitadoPor'] !== actor.uid) throw new ErrorPos('aprobacion-no-coincide', 'La aprobación fue pedida por otro usuario');
  if (raw['tipo'] !== esperado.tipo || raw['moneda'] !== esperado.moneda || enteroDe(raw, 'monto') < esperado.monto) {
    throw new ErrorPos('aprobacion-no-coincide', 'La aprobación no cubre este descuento o crédito');
  }
  if (esperado.tipo === 'credito' && String(raw['deudor'] ?? '').trim().toLowerCase() !== (esperado.deudor ?? '').trim().toLowerCase()) {
    throw new ErrorPos('aprobacion-no-coincide', 'La aprobación es para otro deudor');
  }
  return { raw, aprobadoPor };
}

/** ESCRITURA: marca la aprobación como usada por la venta (de un solo uso). */
export function marcarAprobacionUsada(tx: TransaccionIdentidad, tenantId: string, a: AprobacionLeida, ventaId: string, ahora: number): void {
  tx.set(rutaAprobacion(tenantId, textoDe(a.raw, 'aprobacionId')), { ...a.raw, estado: 'usada', usadaEnVenta: ventaId, usadaEnMs: ahora });
}
