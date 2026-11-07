import {
  consumir,
  registrarAuditoria,
  type BaseDatosIdentidad,
  type DatosPedidoConfirmadoV1,
  type DatosVentaAnuladaV1,
  type EjecutorTransacciones,
  type SobreEvento,
  type TransaccionBandeja,
  type TransaccionIdentidad,
} from '@novutienda/nucleo';
import { EntradaInvalida, EstadoInvalido, ErrorInventario, OperacionConflicto, StockInsuficiente, type Faltante } from './errores.js';
import { hashSalida, aplicarReversion, aplicarSalida, idOperacionSalida, prepararReversion, prepararSalida, type LineaResuelta, type ReferenciaSalida } from './puerto.js';
import { exigirCantidad, exigirProducto, exigirSegmento, exigirTenant, MAX_LINEAS } from './ids.js';
import { verificarFirma } from '@novutienda/nucleo/servidor';
import { Lector, type Autor, type Datos } from './motor.js';


/** Actor de las operaciones originadas por el sistema (pedidos y anulaciones por evento). */
export const ACTOR_SISTEMA: Autor = { uid: 'sistema-pedidos', rol: 'sup' };
export const ALMACEN_PEDIDOS = 'tienda';
export const CONSUMIDOR = 'inventarios';

export interface ItemPedido {
  readonly productoId: string;
  readonly cantidad: number;
}

export type ResultadoPedido =
  | { readonly ok: true; readonly operacionId: string; readonly repetida: boolean; readonly lineas: readonly LineaResuelta[] }
  | { readonly ok: false; readonly faltantes: readonly Faltante[] };

/**
 * Confirma un pedido de WhatsApp: descuenta SIEMPRE de `tienda` (la serie más antigua en los
 * productos con serie). Operación `nc-{pedidoId}`: mismo contenido = misma respuesta; otro
 * contenido = `OperacionConflicto`. Sin stock rechaza SIN escribir el pedido y devuelve los faltantes
 * (queda solo la auditoría), de modo que un reintento tras reponer puede confirmarse.
 */
export async function confirmarPedido(
  tx: TransaccionIdentidad,
  e: { tenantId: string; pedidoId: string; items: readonly ItemPedido[] },
  por: Autor = ACTOR_SISTEMA,
): Promise<ResultadoPedido> {
  const tenantId = exigirTenant(e.tenantId);
  const pedidoId = exigirSegmento(e.pedidoId, 'pedidoId');
  if (!Array.isArray(e.items) || e.items.length < 1 || e.items.length > MAX_LINEAS) throw new EntradaInvalida(`items debe tener entre 1 y ${MAX_LINEAS} elementos`);
  const lineas = e.items.map((i) => ({
    productoId: exigirProducto(i.productoId),
    cantidad: exigirCantidad(i.cantidad),
    almacenId: ALMACEN_PEDIDOS,
  }));
  const ref: ReferenciaSalida = { tipo: 'pedido', id: pedidoId };
  const opId = idOperacionSalida(ref);
  const previa = await new Lector(tx, tenantId).leer('operaciones', opId);
  if (previa !== undefined) {
    if (previa['hashCarga'] !== hashSalida(lineas)) throw new OperacionConflicto(opId);
    const guardadas = ((previa['resultado'] as Datos | undefined)?.['lineas'] ?? []) as LineaResuelta[];
    return { ok: true, operacionId: opId, repetida: true, lineas: guardadas };
  }
  try {
    const plan = await prepararSalida(tx, tenantId, lineas);
    aplicarSalida(tx, plan, ref, por);
    return { ok: true, operacionId: opId, repetida: false, lineas: plan.lineas };
  } catch (error) {
    if (!(error instanceof StockInsuficiente)) throw error;
    registrarAuditoria(tx, {
      tenantId,
      uid: por.uid,
      rol: por.rol,
      accion: 'inventarios.pedido-rechazado',
      ruta: `operaciones/${opId}`,
      resumenDespues: {
        pedidoId,
        faltantes: error.faltantes.map((f) => ({ productoId: f.productoId, pedido: f.pedido, disponible: f.disponible })),
      },
    });
    return { ok: false, faltantes: error.faltantes };
  }
}

/** Transacción con lo que necesitan a la vez las operaciones de inventario y la bandeja de eventos. */
export type TransaccionInventario = TransaccionIdentidad & TransaccionBandeja;

/** Adapta una base de datos de identidad al ejecutor que pide `consumir` (la bandeja del núcleo). */
export function ejecutorDesde(db: BaseDatosIdentidad): EjecutorTransacciones<TransaccionInventario> {
  return {
    transaccion: (fn) =>
      db.runTransaction((tx) =>
        fn({
          get: (r) => tx.get(r),
          set: (r, d) => {
            tx.set(r, d);
          },
          delete: (r) => {
            tx.delete(r);
          },
          create: (r, d) => {
            tx.create(r, d);
          },
          nuevoId: (c) => tx.nuevoId(c),
          marcaTiempoServidor: () => tx.marcaTiempoServidor(),
          existe: async (r) => (await tx.get(r)).existe,
        }),
      ),
  };
}

/** Consume `pedido.confirmado`: una sola vez por evento. Un rechazo por stock queda auditado y el evento se da por procesado. */
export function consumirPedidoConfirmado(
  ejecutor: EjecutorTransacciones<TransaccionInventario>,
  evento: SobreEvento,
): Promise<boolean> {
  return consumir(ejecutor, {
    consumidor: CONSUMIDOR,
    evento,
    manejador: async (tx, ev) => {
      if (ev.tipo !== 'pedido.confirmado') throw new EntradaInvalida(`Tipo inesperado: ${ev.tipo}`);
      const d = ev.datos as DatosPedidoConfirmadoV1;
      await confirmarPedido(tx, { tenantId: ev.tenantId, pedidoId: d.pedidoId, items: d.lineas });
    },
  });
}

/**
 * Consume `venta.anulada`: revierte stock y series de la venta. Las líneas del evento deben
 * coincidir con las que Inventarios descontó (cantidad y series); si no, falla.
 */
export function consumirVentaAnulada(
  ejecutor: EjecutorTransacciones<TransaccionInventario>,
  evento: SobreEvento,
): Promise<boolean> {
  return consumir(ejecutor, {
    consumidor: CONSUMIDOR,
    evento,
    manejador: async (tx, ev) => {
      if (ev.tipo !== 'venta.anulada') throw new EntradaInvalida(`Tipo inesperado: ${ev.tipo}`);
      const d = ev.datos as DatosVentaAnuladaV1;
      const ref: ReferenciaSalida = { tipo: 'venta', id: exigirSegmento(d.ventaId, 'ventaId') };
      const plan = await prepararReversion(tx, ev.tenantId, ref);
      for (const l of plan.lineas) {
        const igual = d.lineas.some(
          (x) =>
            x.productoId === l.productoId &&
            x.almacenId === l.almacenId &&
            x.cantidad === l.cantidad &&
            [...x.series].sort().join('|') === [...l.series].sort().join('|'),
        );
        if (!igual) throw new EstadoInvalido(`Las líneas del evento no coinciden con la venta: ${l.productoId}`);
      }
      aplicarReversion(tx, plan, ref, { uid: d.aprobadoPor, rol: 'sup' });
    },
  });
}

// ---------------------------------------------------------------------------
// Endpoint firmado
// ---------------------------------------------------------------------------

export interface SolicitudConfirmarPedido {
  readonly tenantId: string;
  /** Cabecera con la marca de tiempo (ms Unix, 13 dígitos). */
  readonly marcaTiempo: string;
  /** Cabecera con la firma HMAC-SHA256 en hexadecimal. */
  readonly firma: string;
  /** Cuerpo EXACTO recibido (texto), el que se firmó. */
  readonly cuerpo: string;
}

export interface RespuestaHttp {
  readonly estado: 200 | 400 | 401 | 409;
  readonly cuerpo: Readonly<Record<string, unknown>>;
}

const MAX_CUERPO = 64 * 1024;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** Valida el cuerpo `{pedidoId, items[{productoId,cantidad}], confirmadoEn}` (claves exactas). */
export function leerCuerpoPedido(cuerpo: string): { pedidoId: string; items: ItemPedido[]; confirmadoEn: string } {
  if (typeof cuerpo !== 'string' || cuerpo.length > MAX_CUERPO) throw new EntradaInvalida('cuerpo inválido o demasiado grande');
  let o: unknown;
  try {
    o = JSON.parse(cuerpo);
  } catch {
    throw new EntradaInvalida('El cuerpo no es JSON');
  }
  if (typeof o !== 'object' || o === null || Array.isArray(o)) throw new EntradaInvalida('El cuerpo debe ser un objeto');
  const r = o as Record<string, unknown>;
  const claves = Object.keys(r).sort().join(',');
  if (claves !== 'confirmadoEn,items,pedidoId') throw new EntradaInvalida('El cuerpo requiere exactamente pedidoId, items y confirmadoEn');
  const confirmadoEn = r['confirmadoEn'];
  if (typeof confirmadoEn !== 'string' || !ISO_UTC.test(confirmadoEn) || Number.isNaN(Date.parse(confirmadoEn))) {
    throw new EntradaInvalida('confirmadoEn debe ser ISO 8601 UTC');
  }
  const items = r['items'];
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_LINEAS) throw new EntradaInvalida('items inválido');
  const lista = items.map((i: unknown) => {
    const it = i as Record<string, unknown> | null;
    if (typeof it !== 'object' || it === null || Object.keys(it).sort().join(',') !== 'cantidad,productoId') {
      throw new EntradaInvalida('cada item requiere exactamente productoId y cantidad');
    }
    return { productoId: exigirProducto(it['productoId']), cantidad: exigirCantidad(it['cantidad']) };
  });
  return { pedidoId: exigirSegmento(r['pedidoId'], 'pedidoId'), items: lista, confirmadoEn };
}

/**
 * Endpoint `confirmarPedido`: verifica la firma (HMAC-SHA256, ventana de 5 min), valida el cuerpo y
 * confirma el pedido en una transacción. Devuelve 200 (ok o repetido), 400, 401 o 409 (faltantes,
 * contenido distinto o producto no vendible). Otros errores se propagan (500 en el borde).
 */
export async function confirmarPedidoFirmado(
  deps: { db: BaseDatosIdentidad; secreto: string; ahora?: () => number },
  s: SolicitudConfirmarPedido,
): Promise<RespuestaHttp> {
  const v = verificarFirma({
    secreto: deps.secreto,
    marcaTiempo: s.marcaTiempo,
    cuerpo: s.cuerpo,
    firma: s.firma,
    ahoraMs: (deps.ahora ?? Date.now)(),
  });
  if (!v.ok) return { estado: 401, cuerpo: { error: v.motivo } };
  try {
    const p = leerCuerpoPedido(s.cuerpo);
    const r = await deps.db.runTransaction((tx) => confirmarPedido(tx, { tenantId: s.tenantId, pedidoId: p.pedidoId, items: p.items }));
    if (r.ok) return { estado: 200, cuerpo: { ok: true, operacionId: r.operacionId, repetida: r.repetida } };
    return { estado: 409, cuerpo: { ok: false, error: 'stock-insuficiente', faltantes: r.faltantes } };
  } catch (error) {
    if (error instanceof EntradaInvalida) return { estado: 400, cuerpo: { error: 'entrada-invalida', mensaje: error.message } };
    if (error instanceof ErrorInventario) return { estado: 409, cuerpo: { error: error.codigo, mensaje: error.message } };
    throw error;
  }
}
