import { aCentavos, precioFinal, type CopiaCotizacion, type Mercado, type Moneda, type TransaccionIdentidad } from '@plataforma/nucleo';
import { leerAprobacionParaUso, marcarAprobacionUsada, type AprobacionLeida } from './aprobaciones.js';
import { sumarTotales, deltaPorMedio } from './arqueo.js';
import { TOTAL_MAXIMO, descuentoExcedeTope, validarPagos } from './calculo.js';
import { leerConfigPos } from './config.js';
import {
  ahoraDe, auditar, cotizacionVigente, exigirActor, exigirCentavos, exigirTenant, exigirTexto, exigirUuid, leerObligatorio, publicar,
  rutaContadorRecibo, rutaCredito, rutaTurno, rutaVenta, type DepsPos,
} from './contexto.js';
import { ErrorPos } from './errores.js';
import { leerVenta } from './lectura.js';
import {
  ALMACENES_POS, MONEDAS_POS, type ActorPos, type LineaVenta, type TotalesTurno, type VentaPos,
} from './tipos.js';
import { leerTurnoAbierto } from './turno.js';

export interface LineaCarrito {
  readonly productoId: string;
  readonly cantidad: number;
  /** Por defecto `tienda`. */
  readonly almacenId?: string;
  readonly series?: readonly string[];
  /** Precio que el cliente mostró en pantalla; si no coincide con el del servidor, se rechaza. Nunca fija el precio. */
  readonly precioMostrado?: number;
}

export interface Carrito {
  /** Lista de precios del mercado de la venta (BO o AR). */
  readonly mercado: Mercado;
  /** BOB solo con BO, ARS solo con AR; USD con cualquiera. */
  readonly moneda: Moneda;
  readonly lineas: readonly LineaCarrito[];
  readonly descuento?: { readonly monto: number; readonly motivo: string };
  readonly cliente?: { readonly nombre: string; readonly telefono?: string };
  /** Total que el cliente mostró; si difiere del recalculado, se rechaza. */
  readonly totalMostrado?: number;
}

export interface ResultadoVenta {
  readonly venta: VentaPos;
  /** `true` si el requestId ya estaba confirmado: se devuelve la venta original sin repetir nada. */
  readonly repetida: boolean;
}

const MONEDA_DEL_MERCADO: Readonly<Record<Mercado, Moneda>> = { BO: 'BOB', AR: 'ARS' };
const MAX_LINEAS = 100;
const MAX_CANTIDAD = 100_000;

function validarCarrito(c: Carrito): void {
  if (typeof c !== 'object' || c === null) throw new ErrorPos('entrada-invalida', 'Carrito inválido');
  if (c.mercado !== 'BO' && c.mercado !== 'AR') throw new ErrorPos('entrada-invalida', 'mercado debe ser BO o AR');
  if (!MONEDAS_POS.includes(c.moneda)) throw new ErrorPos('entrada-invalida', 'moneda inválida');
  if (c.moneda !== 'USD' && c.moneda !== MONEDA_DEL_MERCADO[c.mercado]) {
    throw new ErrorPos('entrada-invalida', 'La moneda no corresponde a la lista de precios del mercado');
  }
  if (!Array.isArray(c.lineas) || c.lineas.length === 0 || c.lineas.length > MAX_LINEAS) {
    throw new ErrorPos('entrada-invalida', `El carrito debe tener entre 1 y ${MAX_LINEAS} líneas`);
  }
  const vistas = new Set<string>();
  for (const l of c.lineas) {
    if (typeof l?.productoId !== 'string' || l.productoId === '' || l.productoId.includes('/')) throw new ErrorPos('entrada-invalida', 'productoId inválido');
    if (typeof l.cantidad !== 'number' || !Number.isSafeInteger(l.cantidad) || l.cantidad < 1 || l.cantidad > MAX_CANTIDAD) {
      throw new ErrorPos('entrada-invalida', 'La cantidad debe ser un entero positivo');
    }
    const alm = l.almacenId ?? 'tienda';
    if (!ALMACENES_POS.includes(alm)) throw new ErrorPos('entrada-invalida', 'Almacén desconocido');
    const clave = `${alm}/${l.productoId}`;
    if (vistas.has(clave)) throw new ErrorPos('entrada-invalida', 'Un producto no puede repetirse en el mismo almacén; sume las cantidades');
    vistas.add(clave);
    if (l.precioMostrado !== undefined) exigirCentavos(l.precioMostrado, 'precioMostrado');
  }
  if (c.totalMostrado !== undefined) exigirCentavos(c.totalMostrado, 'totalMostrado');
  if (c.descuento !== undefined) {
    exigirCentavos(c.descuento.monto, 'descuento.monto', 1);
    exigirTexto(c.descuento.motivo, 'El motivo del descuento');
  }
  if (c.cliente !== undefined) {
    exigirTexto(c.cliente.nombre, 'cliente.nombre', 100);
    if (c.cliente.telefono !== undefined) exigirTexto(c.cliente.telefono, 'cliente.telefono', 30);
  }
}

async function precioDeLinea(
  deps: DepsPos,
  tx: TransaccionIdentidad,
  tenantId: string,
  c: Carrito,
  cotizacion: CopiaCotizacion | null,
  l: LineaCarrito,
): Promise<LineaVenta> {
  const prod = await deps.catalogo.leerProducto(tx, tenantId, l.productoId);
  if (prod === null) throw new ErrorPos('producto-inexistente', 'El producto no existe');
  if (!prod.activo) throw new ErrorPos('producto-inactivo', 'El producto está inactivo');
  const usd = prod.preciosUsd[c.mercado];
  if (usd === undefined) throw new ErrorPos('sin-precio', 'El producto no tiene precio en esta lista');
  let centavos: number;
  if (c.moneda === 'USD') {
    if (!Number.isFinite(usd) || usd <= 0) throw new ErrorPos('sin-precio', 'El producto no tiene precio (a consultar)');
    centavos = aCentavos(usd);
  } else {
    if (cotizacion === null) throw new ErrorPos('dato-corrupto', 'Falta la cotización');
    const p = precioFinal(usd, c.mercado, { par: cotizacion.par, valor: cotizacion.valor }, deps.redondeo);
    if (p.tipo === 'sin_precio') throw new ErrorPos('sin-precio', 'El producto no tiene precio (a consultar)');
    if (p.tipo === 'invalido') throw new ErrorPos('sin-precio', `No se pudo calcular el precio: ${p.motivo}`);
    centavos = p.centavos;
  }
  if (l.precioMostrado !== undefined && l.precioMostrado !== centavos) {
    throw new ErrorPos('precio-alterado', 'El precio mostrado no coincide con el del servidor');
  }
  const series = l.series ?? [];
  if (prod.controlaSeries) {
    const unicas = new Set(series);
    if (series.length !== l.cantidad || unicas.size !== series.length || series.some((s) => typeof s !== 'string' || s.trim() === '' || s.length > 100)) {
      throw new ErrorPos('series-invalidas', 'Indique una serie distinta por unidad');
    }
  } else if (series.length > 0) {
    throw new ErrorPos('series-invalidas', 'El producto no se controla por serie');
  }
  return {
    productoId: l.productoId,
    nombre: prod.nombre,
    cantidad: l.cantidad,
    precioUnitario: centavos,
    almacenId: l.almacenId ?? 'tienda',
    series: [...series],
    ...(prod.garantiaMeses !== undefined ? { garantiaMeses: prod.garantiaMeses } : {}),
  };
}

/**
 * Confirma una venta en UNA transacción. `requestId` (UUID del cliente) es el id de la venta:
 * reintentar devuelve la venta original sin descontar stock ni publicar de nuevo.
 * `aprobacionId` es la aprobación del descuento (si supera el tope del rol);
 * `aprobacionCreditoId`, la del crédito cuando vende un cajero.
 */
export async function confirmarVenta(
  deps: DepsPos,
  tenantId: string,
  actor: ActorPos,
  requestId: string,
  carrito: Carrito,
  pagosEntrada: unknown,
  aprobacionId?: string,
  aprobacionCreditoId?: string,
): Promise<ResultadoVenta> {
  exigirTenant(tenantId);
  exigirActor(actor);
  const ventaId = exigirUuid(requestId, 'requestId');
  validarCarrito(carrito);
  const ahora = ahoraDe(deps);
  return deps.db.runTransaction(async (tx) => {
    // 1) Idempotencia.
    const previa = await leerObligatorio(tx, rutaVenta(tenantId, ventaId));
    if (previa !== undefined) {
      const v = leerVenta(previa);
      if (v.cajeroUid !== actor.uid) throw new ErrorPos('request-en-uso', 'Ese identificador de venta ya se usó');
      return { venta: v, repetida: true };
    }
    // 2) Turno abierto del usuario y caja activa.
    const abierto = await leerTurnoAbierto(tx, tenantId);
    if (abierto === undefined) throw new ErrorPos('sin-turno', 'No hay un turno abierto: abra el turno antes de vender');
    const { turno } = abierto;
    if (turno.cajeroUid !== actor.uid) throw new ErrorPos('turno-ajeno', 'El turno abierto es de otro usuario');
    const config = await leerConfigPos(tx, tenantId);
    // 3) Precios y total recalculados en el servidor.
    const cotizacion = carrito.moneda === 'USD' ? null : await cotizacionVigente(deps, tx, tenantId, carrito.mercado);
    const lineas: LineaVenta[] = [];
    for (const l of carrito.lineas) lineas.push(await precioDeLinea(deps, tx, tenantId, carrito, cotizacion, l));
    const subtotal = lineas.reduce((s, l) => s + l.cantidad * l.precioUnitario, 0);
    if (!Number.isSafeInteger(subtotal) || subtotal > TOTAL_MAXIMO) throw new ErrorPos('entrada-invalida', 'El total de la venta es demasiado grande');
    // Descuento: tope del rol o aprobación de un solo uso (nunca autoaprobada).
    let descuento: VentaPos['descuento'];
    let aprobacionDescuento: AprobacionLeida | undefined;
    if (carrito.descuento !== undefined) {
      const { monto, motivo } = carrito.descuento;
      if (monto >= subtotal) throw new ErrorPos('entrada-invalida', 'El descuento debe ser menor que el subtotal');
      if (descuentoExcedeTope(subtotal, monto, config.topesDescuentoBp[actor.rol])) {
        if (aprobacionId === undefined) throw new ErrorPos('descuento-sin-aprobacion', 'El descuento supera su tope: pida la aprobación de un supervisor');
        aprobacionDescuento = await leerAprobacionParaUso(tx, tenantId, aprobacionId, actor, ahora, { tipo: 'descuento', moneda: carrito.moneda, monto });
        descuento = { monto, motivo: motivo.trim(), aprobadoPor: aprobacionDescuento.aprobadoPor, aprobacionId };
      } else {
        descuento = { monto, motivo: motivo.trim() };
      }
    }
    const total = subtotal - (descuento?.monto ?? 0);
    if (carrito.totalMostrado !== undefined && carrito.totalMostrado !== total) {
      throw new ErrorPos('precio-alterado', 'El total mostrado no coincide con el del servidor');
    }
    // Pagos en una sola moneda; suma − cambio = total.
    const pagos = validarPagos(pagosEntrada, { moneda: carrito.moneda, total, medios: config.mediosHabilitados, actor });
    // Crédito: con nombre del deudor y aprobado por sup/adm.
    const pagoCredito = pagos.find((p) => p.medio === 'credito');
    let aprobacionCredito: AprobacionLeida | undefined;
    let creditoAprobadoPor: string | undefined;
    if (pagoCredito !== undefined) {
      const deudor = carrito.cliente?.nombre;
      if (deudor === undefined) throw new ErrorPos('pagos-invalidos', 'El crédito exige el nombre del deudor');
      if (actor.rol === 'caj') {
        if (aprobacionCreditoId === undefined) throw new ErrorPos('aprobacion-inexistente', 'El crédito necesita la aprobación de un supervisor o administrador');
        aprobacionCredito = await leerAprobacionParaUso(tx, tenantId, aprobacionCreditoId, actor, ahora, { tipo: 'credito', moneda: carrito.moneda, monto: pagoCredito.monto, deudor });
        creditoAprobadoPor = aprobacionCredito.aprobadoPor;
      } else {
        creditoAprobadoPor = actor.uid;
      }
    }
    // Contador del recibo.
    const rutaContador = rutaContadorRecibo(tenantId, config.serieRecibo);
    const cont = await leerObligatorio(tx, rutaContador);
    const ultimo = cont === undefined ? 0 : cont['ultimo'];
    if (typeof ultimo !== 'number' || !Number.isSafeInteger(ultimo) || ultimo < 0) throw new ErrorPos('dato-corrupto', 'El contador del recibo es inválido');
    const receiptNo = ultimo + 1;
    // 4) Stock: falla de stock o serie aborta todo (solo lecturas aquí).
    const ref = { tipo: 'venta' as const, id: ventaId };
    const por = { uid: actor.uid, rol: actor.rol };
    const plan = await deps.inventarios.prepararSalida(
      tx,
      tenantId,
      lineas.map((l) => ({ productoId: l.productoId, cantidad: l.cantidad, almacenId: l.almacenId, ...(l.series.length > 0 ? { series: l.series } : {}) })),
    );

    // 5) Escrituras.
    deps.inventarios.aplicarSalida(tx, plan, ref, por);
    tx.set(rutaContador, { ultimo: receiptNo, serie: config.serieRecibo });
    if (aprobacionDescuento !== undefined) marcarAprobacionUsada(tx, tenantId, aprobacionDescuento, ventaId, ahora);
    if (aprobacionCredito !== undefined) marcarAprobacionUsada(tx, tenantId, aprobacionCredito, ventaId, ahora);
    const venta: VentaPos = {
      ventaId,
      turnoId: turno.turnoId,
      cajaId: turno.cajaId,
      cajeroUid: actor.uid,
      estado: 'confirmada',
      moneda: carrito.moneda,
      mercado: carrito.mercado,
      cotizacion,
      lineas,
      subtotal,
      ...(descuento !== undefined ? { descuento } : {}),
      total,
      pagos,
      ...(carrito.cliente !== undefined
        ? { cliente: { nombre: carrito.cliente.nombre.trim(), ...(carrito.cliente.telefono !== undefined ? { telefono: carrito.cliente.telefono.trim() } : {}) } }
        : {}),
      serie: config.serieRecibo,
      receiptNo,
      creadoEnMs: ahora,
    };
    tx.set(rutaVenta(tenantId, ventaId), { ...venta, creadoEn: tx.marcaTiempoServidor() });
    let totales: TotalesTurno = turno.totales;
    for (const p of pagos) totales = sumarTotales(totales, venta.moneda, deltaPorMedio(p.medio, p.monto - (p.cambio ?? 0)));
    tx.set(rutaTurno(tenantId, turno.turnoId), { ...abierto.raw, totales });
    if (pagoCredito !== undefined && carrito.cliente !== undefined && creditoAprobadoPor !== undefined) {
      tx.set(rutaCredito(tenantId, ventaId), {
        ventaId,
        deudor: carrito.cliente.nombre.trim(),
        moneda: venta.moneda,
        monto: pagoCredito.monto,
        saldo: pagoCredito.monto,
        cobrado: 0,
        estado: 'pendiente',
        aprobadoPor: creditoAprobadoPor,
        turnoId: turno.turnoId,
        creadoEnMs: ahora,
      });
    }
    publicar(tx, {
      tenantId,
      tipo: 'venta.confirmada',
      clave: `venta-confirmada.${ventaId}`,
      ocurridoEnMs: ahora,
      datos: {
        ventaId,
        turnoId: turno.turnoId,
        cajaId: turno.cajaId,
        cajeroUid: actor.uid,
        moneda: venta.moneda,
        total,
        cotizacion,
        ...(descuento !== undefined
          ? { descuento: { monto: descuento.monto, motivo: descuento.motivo, ...(descuento.aprobadoPor !== undefined ? { aprobadoPor: descuento.aprobadoPor } : {}) } }
          : {}),
        lineas,
        pagos: pagos.map((p) => ({
          medio: p.medio,
          moneda: p.moneda,
          monto: p.monto,
          ...(p.cambio !== undefined ? { cambio: p.cambio } : {}),
          ...(p.referencia !== undefined ? { referencia: p.referencia } : {}),
        })),
        ...(venta.cliente !== undefined ? { cliente: venta.cliente } : {}),
      },
    });
    auditar(tx, tenantId, actor, {
      accion: 'pos.venta.confirmar',
      ruta: rutaVenta(tenantId, ventaId),
      despues: { ventaId, turnoId: turno.turnoId, moneda: venta.moneda, total, receiptNo, lineas: lineas.length },
      ...(descuento !== undefined ? { motivo: descuento.motivo } : {}),
    });
    return { venta, repetida: false };
  });
}
