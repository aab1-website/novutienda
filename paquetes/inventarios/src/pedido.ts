import {
  consumir,
  registrarAuditoria,
  type BaseDatosIdentidad,
  type DatosPedidoConfirmadoV1,
  type DatosVentaAnuladaV1,
  type DatosVentaAnuladaV2,
  type EjecutorTransacciones,
  type SobreEvento,
  type TransaccionBandeja,
  type TransaccionIdentidad,
} from '@novutienda/nucleo';
import { EntradaInvalida, EstadoInvalido, ErrorInventario, OperacionConflicto, StockInsuficiente, type Faltante } from './errores.js';
import { hashSalida, aplicarReversion, aplicarSalida, idOperacionReversion, idOperacionSalida, prepararReversion, prepararSalida, type LineaResuelta, type ReferenciaSalida } from './puerto.js';
import { exigirCantidad, exigirProducto, exigirSegmento, exigirTenant, MAX_LINEAS } from './ids.js';
import { verificarFirma } from '@novutienda/nucleo/servidor';
import { Lector, type Autor, type Datos } from './motor.js';


/** Actor de las operaciones originadas por el sistema (pedidos y anulaciones por evento). */
export const ACTOR_SISTEMA: Autor = { uid: 'sistema-pedidos', rol: 'sup' };
export const ALMACEN_PEDIDOS = 'tienda';
export const CONSUMIDOR = 'inventarios';

/**
 * Versiones de cada evento que Inventarios entiende. `venta.anulada` v2 solo cambia la moneda de los reembolsos,
 * que el manejador no lee; `pedido.confirmado` sigue en la 1 (los pedidos v2 aún no tienen emisor).
 */
export const VERSIONES_CONSUMO_INVENTARIOS = { 'venta.anulada': [1, 2], 'pedido.confirmado': [1] } as const;

/** El pedido ya fue anulado (`nc-anula-{id}`): confirmarlo no descuenta. El borde responde 409 `pedido-anulado`. */
export class PedidoAnulado extends ErrorInventario {
  constructor(readonly pedidoId: string) {
    super('failed-precondition', `El pedido ${pedidoId} ya fue anulado`);
    this.name = 'PedidoAnulado';
  }
}

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
  e: { tenantId: string; pedidoId: string; items: readonly ItemPedido[]; nota?: string },
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
  const lector = new Lector(tx, tenantId);
  const [previa, anulada] = await Promise.all([lector.leer('operaciones', opId), lector.leer('operaciones', idOperacionReversion(ref))]);
  if (anulada !== undefined) throw new PedidoAnulado(pedidoId);
  if (previa !== undefined) {
    if (previa['hashCarga'] !== hashSalida(lineas)) throw new OperacionConflicto(opId);
    const guardadas = ((previa['resultado'] as Datos | undefined)?.['lineas'] ?? []) as LineaResuelta[];
    return { ok: true, operacionId: opId, repetida: true, lineas: guardadas };
  }
  try {
    const plan = await prepararSalida(tx, tenantId, lineas);
    aplicarSalida(tx, plan, ref, por, e.nota === undefined || e.nota === '' ? undefined : exigirNota(e.nota));
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

export type ResultadoAnulacion =
  | { readonly ok: true; readonly operacionId: string; readonly repetida: boolean }
  | { readonly ok: false; readonly error: 'pedido-no-encontrado' };

/**
 * Anula un pedido confirmado (completo, sin plazo): devuelve stock y series a la tienda y graba `nc-anula-{pedidoId}`.
 * Repetir la anulación no escribe nada. Un pedido sin confirmación registrada (incluido el rechazado por stock) devuelve
 * `pedido-no-encontrado`. Una serie que ya no está vendida en ese pedido o un producto borrado lanzan un error de inventario.
 */
export async function anularPedido(
  tx: TransaccionIdentidad,
  e: { tenantId: string; pedidoId: string; anuladoEn?: string },
  por: Autor = ACTOR_SISTEMA,
): Promise<ResultadoAnulacion> {
  const tenantId = exigirTenant(e.tenantId);
  const pedidoId = exigirSegmento(e.pedidoId, 'pedidoId');
  const ref: ReferenciaSalida = { tipo: 'pedido', id: pedidoId };
  const orig = await new Lector(tx, tenantId).leer('operaciones', idOperacionSalida(ref));
  if (orig === undefined) return { ok: false, error: 'pedido-no-encontrado' };
  const plan = await prepararReversion(tx, tenantId, ref);
  aplicarReversion(tx, plan, ref, por);
  if (!plan.repetida && e.anuladoEn !== undefined) {
    registrarAuditoria(tx, {
      tenantId,
      uid: por.uid,
      rol: por.rol,
      accion: 'inventarios.pedido-anulado',
      ruta: `operaciones/${idOperacionReversion(ref)}`,
      resumenDespues: { pedidoId, anuladoEn: e.anuladoEn },
    });
  }
  return { ok: true, operacionId: idOperacionReversion(ref), repetida: plan.repetida };
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
    versiones: VERSIONES_CONSUMO_INVENTARIOS['pedido.confirmado'],
    manejador: async (tx, ev) => {
      if (ev.tipo !== 'pedido.confirmado') throw new EntradaInvalida(`Tipo inesperado: ${ev.tipo}`);
      const d = ev.datos as DatosPedidoConfirmadoV1;
      try {
        await confirmarPedido(tx, { tenantId: ev.tenantId, pedidoId: d.pedidoId, items: d.lineas });
      } catch (error) {
        // Un pedido anulado antes de que llegue su evento no descuenta: el evento se da por procesado.
        if (!(error instanceof PedidoAnulado)) throw error;
        registrarAuditoria(tx, {
          tenantId: ev.tenantId,
          uid: ACTOR_SISTEMA.uid,
          rol: ACTOR_SISTEMA.rol,
          accion: 'inventarios.pedido-descartado-anulado',
          ruta: `operaciones/${idOperacionReversion({ tipo: 'pedido', id: d.pedidoId })}`,
          resumenDespues: { pedidoId: d.pedidoId },
        });
      }
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
    versiones: VERSIONES_CONSUMO_INVENTARIOS['venta.anulada'],
    manejador: async (tx, ev) => {
      if (ev.tipo !== 'venta.anulada') throw new EntradaInvalida(`Tipo inesperado: ${ev.tipo}`);
      const d = ev.datos as DatosVentaAnuladaV1 | DatosVentaAnuladaV2;
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

function leerObjeto(cuerpo: string): Record<string, unknown> {
  if (typeof cuerpo !== 'string' || cuerpo.length > MAX_CUERPO) throw new EntradaInvalida('cuerpo inválido o demasiado grande');
  let o: unknown;
  try {
    o = JSON.parse(cuerpo);
  } catch {
    throw new EntradaInvalida('El cuerpo no es JSON');
  }
  if (typeof o !== 'object' || o === null || Array.isArray(o)) throw new EntradaInvalida('El cuerpo debe ser un objeto');
  return o as Record<string, unknown>;
}

export const MAX_NOTA = 500;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/** Nota del cliente: texto de 1 a 500 caracteres (puntos de código), sin caracteres de control (tampoco saltos de línea: el carrito del sitio los convierte en espacio). */
function exigirNota(x: unknown): string {
  if (typeof x !== 'string') throw new EntradaInvalida('nota debe ser texto');
  const n = Array.from(x).length;
  if (n < 1 || n > MAX_NOTA) throw new EntradaInvalida(`nota debe tener de 1 a ${String(MAX_NOTA)} caracteres`);
  if (CONTROL.test(x)) throw new EntradaInvalida('nota no admite caracteres de control');
  return x;
}

/** Valida el cuerpo `{pedidoId, items[{productoId,cantidad}], confirmadoEn, nota?}` (claves exactas; `nota` opcional, ausente o "" = sin nota). */
export function leerCuerpoPedido(cuerpo: string): { pedidoId: string; items: ItemPedido[]; confirmadoEn: string; nota?: string } {
  const r = leerObjeto(cuerpo);
  const claves = Object.keys(r).filter((k) => k !== 'nota').sort().join(',');
  if (claves !== 'confirmadoEn,items,pedidoId') throw new EntradaInvalida('El cuerpo requiere pedidoId, items y confirmadoEn, y admite solo nota como opcional');
  const nota = 'nota' in r && r['nota'] !== '' ? exigirNota(r['nota']) : undefined;
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
  return { pedidoId: exigirSegmento(r['pedidoId'], 'pedidoId'), items: lista, confirmadoEn, ...(nota !== undefined ? { nota } : {}) };
}

/**
 * Endpoint `confirmarPedido`: verifica la firma (HMAC-SHA256, ventana de 5 min), valida el cuerpo y
 * confirma el pedido en una transacción. `autorizado` (opcional) se evalúa tras la firma y antes de leer el cuerpo. Devuelve 200 (ok o repetido), 400, 401 o 409 (faltantes,
 * contenido distinto o producto no vendible). Otros errores se propagan (500 en el borde).
 */
export async function confirmarPedidoFirmado(
  deps: DependenciasFirmadas,
  s: SolicitudConfirmarPedido,
): Promise<RespuestaHttp> {
  const rechazo = await rechazarSinFirma(deps, s);
  if (rechazo !== undefined) return rechazo;
  try {
    const p = leerCuerpoPedido(s.cuerpo);
    const r = await deps.db.runTransaction((tx) => confirmarPedido(tx, { tenantId: s.tenantId, pedidoId: p.pedidoId, items: p.items, ...(p.nota !== undefined ? { nota: p.nota } : {}) }));
    if (r.ok) return { estado: 200, cuerpo: { ok: true, operacionId: r.operacionId, repetida: r.repetida } };
    return { estado: 409, cuerpo: { ok: false, error: 'stock-insuficiente', faltantes: r.faltantes } };
  } catch (error) {
    if (error instanceof PedidoAnulado) return { estado: 409, cuerpo: { ok: false, error: 'pedido-anulado', mensaje: error.message } };
    return errorDeBorde(error);
  }
}

/** Valida el cuerpo `{pedidoId, anuladoEn, tenantId}` (claves exactas; `anuladoEn` ISO 8601 UTC; el tenant liga la firma al host). */
export function leerCuerpoAnulacion(cuerpo: string): { pedidoId: string; anuladoEn: string; tenantId: string } {
  const r = leerObjeto(cuerpo);
  if (Object.keys(r).sort().join(',') !== 'anuladoEn,pedidoId,tenantId') throw new EntradaInvalida('El cuerpo requiere exactamente pedidoId, anuladoEn y tenantId');
  const anuladoEn = r['anuladoEn'];
  if (typeof anuladoEn !== 'string' || !ISO_UTC.test(anuladoEn) || Number.isNaN(Date.parse(anuladoEn))) {
    throw new EntradaInvalida('anuladoEn debe ser ISO 8601 UTC');
  }
  return { pedidoId: exigirSegmento(r['pedidoId'], 'pedidoId'), anuladoEn, tenantId: exigirSegmento(r['tenantId'], 'tenantId') };
}

/**
 * Endpoint `anularPedido`: misma firma, ventana y control de encendido que `confirmarPedidoFirmado`. Devuelve 200 (ok o repetida),
 * 400 (incluye `tenant-distinto`), 401 o 409 (`pedido-no-encontrado`, serie ya no vendida en el pedido o producto borrado). Otros errores se propagan.
 */
export async function anularPedidoFirmado(deps: DependenciasFirmadas, s: SolicitudConfirmarPedido): Promise<RespuestaHttp> {
  const rechazo = await rechazarSinFirma(deps, s);
  if (rechazo !== undefined) return rechazo;
  try {
    const p = leerCuerpoAnulacion(s.cuerpo);
    if (p.tenantId !== s.tenantId) return { estado: 400, cuerpo: { ok: false, error: 'tenant-distinto' } };
    const r = await deps.db.runTransaction((tx) => anularPedido(tx, { tenantId: s.tenantId, pedidoId: p.pedidoId, anuladoEn: p.anuladoEn }));
    if (r.ok) return { estado: 200, cuerpo: { ok: true, operacionId: r.operacionId, repetida: r.repetida } };
    return { estado: 409, cuerpo: { ok: false, error: r.error } };
  } catch (error) {
    return errorDeBorde(error);
  }
}

interface DependenciasFirmadas {
  readonly db: BaseDatosIdentidad;
  readonly secreto: string;
  readonly ahora?: () => number;
  readonly autorizado?: () => Promise<boolean>;
}

/** Firma y control de encendido (este solo tras una firma válida: no revela el estado de los módulos a un anónimo). */
async function rechazarSinFirma(deps: DependenciasFirmadas, s: SolicitudConfirmarPedido): Promise<RespuestaHttp | undefined> {
  const v = verificarFirma({
    secreto: deps.secreto,
    marcaTiempo: s.marcaTiempo,
    cuerpo: s.cuerpo,
    firma: s.firma,
    ahoraMs: (deps.ahora ?? Date.now)(),
  });
  if (!v.ok) return { estado: 401, cuerpo: { error: v.motivo } };
  if (deps.autorizado !== undefined && !(await deps.autorizado())) return { estado: 401, cuerpo: { error: 'credencial_invalida' } };
  return undefined;
}

function errorDeBorde(error: unknown): RespuestaHttp {
  if (error instanceof EntradaInvalida) return { estado: 400, cuerpo: { error: 'entrada-invalida', mensaje: error.message } };
  if (error instanceof ErrorInventario) return { estado: 409, cuerpo: { error: error.codigo, mensaje: error.message } };
  throw error;
}
