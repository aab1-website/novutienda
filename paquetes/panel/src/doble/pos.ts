import type { Entrada, NombreCallable, Salida } from '../api/contrato.js';
import type {
  AprobacionPos, LineaVenta, Moneda, MovimientoCaja, PagoVentaPos, Recibo, ResultadoCierre, TurnoPos, VentaPos,
} from '../api/tipos.js';
import { MEDIOS_PAGO, MONEDAS } from '../api/tipos.js';
import { diferenciaPorMoneda, efectivoEsperado, monedasDelTurno, sumarTotales, TOTALES_VACIOS } from '../util/arqueo.js';
import { MONEDA_DE_MERCADO, precioDeVenta } from '../util/precio.js';
import { aCsv } from '../util/csv.js';
import { auditar, fallo, fechaLaPaz, iso, recalcular, type Contexto } from './estado.js';

type H<N extends NombreCallable> = (c: Contexto, e: Entrada<N>) => Salida<N> | Promise<Salida<N>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const exigirUuid = (x: string, que: string): string => {
  if (!UUID.test(x)) throw fallo('entrada-invalida', `${que} debe ser un UUID`);
  return x;
};
const exigirMonto = (x: number, que: string, min = 0): number => {
  if (!Number.isSafeInteger(x) || x < min) throw fallo('entrada-invalida', `${que} inválido`);
  return x;
};
const exigirTexto = (x: string, que: string): string => {
  if (typeof x !== 'string' || x.trim() === '') throw fallo('entrada-invalida', `${que} es obligatorio`);
  return x.trim();
};

function turnoAbierto(c: Contexto): TurnoPos | undefined {
  return [...c.e.turnos.values()].find((t) => t.estado === 'abierto');
}

function mismoTurno(c: Contexto, t: TurnoPos): void {
  if (t.cajeroUid !== c.uid && c.rol === 'caj') throw fallo('turno-ajeno');
}

export function agregarMonedas(t: TurnoPos, delta: Partial<Record<Moneda, Partial<typeof TOTALES_VACIOS>>>): TurnoPos {
  let totales = t.totales;
  for (const [m, d] of Object.entries(delta) as [Moneda, Partial<typeof TOTALES_VACIOS>][]) totales = sumarTotales(totales, m, d);
  return { ...t, totales };
}

function emitirRecibo(c: Contexto, v: VentaPos): Recibo {
  const numero = `${v.serie}-${String(v.receiptNo).padStart(6, '0')}`;
  const r: Recibo = {
    reciboId: `recibo-${v.ventaId}`, tenantId: c.tenantId, ventaId: v.ventaId, numero, estado: 'EMITIDO', fecha: fechaLaPaz(v.creadoEnMs),
    emitidoEn: iso(v.creadoEnMs), moneda: v.moneda, total: v.total, ...(v.descuento ? { descuento: { monto: v.descuento.monto, motivo: v.descuento.motivo } } : {}),
    cotizacion: v.cotizacion,
    lineas: v.lineas.map((l) => ({
      productoId: l.productoId, nombre: l.nombre, cantidad: l.cantidad, precioUnitario: l.precioUnitario, subtotal: l.cantidad * l.precioUnitario,
      series: l.series, ...(l.garantiaMeses !== undefined ? { garantiaMeses: l.garantiaMeses, garantiaHasta: sumarMeses(fechaLaPaz(v.creadoEnMs), l.garantiaMeses) } : {}),
    })),
    pagos: v.pagos.map((p) => ({ medio: p.medio, moneda: p.moneda, monto: p.monto })),
    ...(v.cliente ? { cliente: v.cliente } : {}), plantilla: c.e.plantilla, envioWhatsapp: { estado: 'no_enviado' },
  };
  c.e.recibos.set(r.reciboId, r);
  return r;
}

/** Suma meses de calendario; si el día no existe en el mes destino, el último día de ese mes. */
export function sumarMeses(fecha: string, meses: number): string {
  const [a = 0, m = 1, d = 1] = fecha.split('-').map(Number);
  const total = a * 12 + (m - 1) + meses;
  const anio = Math.floor(total / 12);
  const mes = total % 12;
  const ultimo = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  return `${anio}-${String(mes + 1).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
}

function usarAprobacion(c: Contexto, id: string, esperado: { tipo: 'descuento' | 'credito'; moneda: Moneda; monto: number; deudor?: string }): AprobacionPos {
  const a = c.e.aprobaciones.get(id);
  if (a === undefined) throw fallo('aprobacion-inexistente');
  if (a.estado === 'usada') throw fallo('aprobacion-usada');
  if (a.estado !== 'aprobada') throw fallo('aprobacion-no-aprobada');
  if (a.solicitadoPor !== c.uid || a.tipo !== esperado.tipo || a.moneda !== esperado.moneda || a.monto < esperado.monto || (esperado.deudor !== undefined && a.deudor !== esperado.deudor)) {
    throw fallo('aprobacion-no-coincide');
  }
  if (a.aprobadoPor === c.uid) throw fallo('autoaprobacion');
  if (c.ahora - a.solicitadoEnMs > 24 * 3600_000) throw fallo('aprobacion-vencida');
  return a;
}

function validarPagos(c: Contexto, pagos: readonly { medio: string; moneda: string; monto: number; cambio?: number; referencia?: string }[], moneda: Moneda, total: number): PagoVentaPos[] {
  if (!Array.isArray(pagos) || pagos.length === 0 || pagos.length > 10) throw fallo('pagos-invalidos', 'Indique entre 1 y 10 pagos');
  let neto = 0;
  const salida: PagoVentaPos[] = [];
  for (const p of pagos) {
    if (!MEDIOS_PAGO.includes(p.medio as never)) throw fallo('pagos-invalidos');
    if (!c.e.configPos.mediosHabilitados.includes(p.medio as never)) throw fallo('medio-no-habilitado');
    if (p.moneda !== moneda) throw fallo('pagos-invalidos', 'Un cobro se hace en una sola moneda');
    exigirMonto(p.monto, 'monto', 1);
    const cambio = p.cambio ?? 0;
    if (cambio > 0 && p.medio !== 'efectivo') throw fallo('pagos-invalidos', 'El cambio solo se da en efectivo');
    if (cambio > p.monto) throw fallo('pagos-invalidos');
    if (p.medio === 'qr' && (p.referencia === undefined || p.referencia.trim() === '')) throw fallo('pagos-invalidos', 'El QR necesita la referencia');
    neto += p.monto - cambio;
    salida.push({
      medio: p.medio as PagoVentaPos['medio'], moneda, monto: p.monto, ...(cambio > 0 ? { cambio } : {}),
      ...(p.referencia !== undefined ? { referencia: p.referencia.trim() } : {}),
      ...(p.medio === 'qr' ? { registradoPor: c.uid } : {}),
    });
  }
  if (neto !== total) throw fallo('pagos-invalidos', 'Los pagos no suman el total');
  return salida;
}

export const handlersPos: {
  [N in 'abrirTurno' | 'cerrarTurno' | 'cerrarTurnoForzado' | 'confirmarVenta' | 'solicitarAprobacion' | 'resolverAprobacion' | 'solicitarAnulacion' | 'aprobarAnulacion' | 'registrarMovimientoCaja' | 'cobrarCredito' | 'guardarConfigPos' | 'leerConfigPos' | 'turnoActual' | 'listarTurnos' | 'listarVentas' | 'listarAprobaciones' | 'listarMovimientosCaja' | 'listarCreditos' | 'listarAuditoria' | 'exportarVentasCsv']: H<N>;
} = {
  abrirTurno(c, e) {
    const id = exigirUuid(e.turnoId, 'turnoId');
    const previo = c.e.turnos.get(id);
    if (previo !== undefined) return previo;
    if (turnoAbierto(c) !== undefined) throw fallo('turno-ya-abierto');
    const apertura: Partial<Record<Moneda, number>> = {};
    for (const [m, v] of Object.entries(e.apertura)) {
      if (!MONEDAS.includes(m as Moneda)) throw fallo('entrada-invalida', 'moneda desconocida');
      apertura[m as Moneda] = exigirMonto(v, `apertura.${m}`);
    }
    if (Object.keys(apertura).length === 0) throw fallo('entrada-invalida', 'apertura necesita al menos una moneda');
    const t: TurnoPos = { turnoId: id, cajaId: 'caja-1', cajeroUid: c.uid, estado: 'abierto', apertura, totales: {}, abiertoEnMs: c.ahora };
    c.e.turnos.set(id, t);
    auditar(c, 'pos.turno.abrir', `turnos/${id}`);
    return t;
  },

  cerrarTurno(c, e) {
    return cerrar(c, e.turnoId, e.contado, false);
  },
  cerrarTurnoForzado(c, e) {
    exigirTexto(e.motivo, 'motivo');
    return cerrar(c, e.turnoId, e.contado, true, e.motivo.trim());
  },

  confirmarVenta(c, e) {
    const ventaId = exigirUuid(e.requestId, 'requestId');
    const previa = c.e.ventas.get(ventaId);
    if (previa !== undefined) {
      if (previa.cajeroUid !== c.uid) throw fallo('request-en-uso');
      return { venta: previa, repetida: true };
    }
    const turno = turnoAbierto(c);
    if (turno === undefined) throw fallo('sin-turno');
    if (turno.cajeroUid !== c.uid) throw fallo('turno-ajeno');
    const k = e.carrito;
    if (k.moneda !== 'USD' && k.moneda !== MONEDA_DE_MERCADO[k.mercado]) throw fallo('entrada-invalida', 'La moneda no corresponde a la lista de precios');
    if (k.lineas.length === 0) throw fallo('entrada-invalida', 'Carrito vacío');
    const cot = k.moneda === 'USD' ? null : c.e.cotizaciones[k.mercado];
    const lineas: LineaVenta[] = [];
    const vistas = new Set<string>();
    for (const l of k.lineas) {
      const alm = l.almacenId ?? 'tienda';
      const clave = `${alm}/${l.productoId}`;
      if (vistas.has(clave)) throw fallo('entrada-invalida', 'Producto repetido en el mismo almacén');
      vistas.add(clave);
      if (!Number.isSafeInteger(l.cantidad) || l.cantidad < 1) throw fallo('entrada-invalida', 'Cantidad inválida');
      const p = c.e.productos.get(l.productoId);
      if (p === undefined) throw fallo('producto-inexistente');
      if (!p.activo) throw fallo('producto-inactivo');
      const usd = k.mercado === 'BO' ? p.precioUSD.bo : p.precioUSD.ar;
      const pv = precioDeVenta(usd, k.mercado, k.moneda, cot);
      if (pv.tipo !== 'precio') throw fallo('sin-precio');
      if (l.precioMostrado !== undefined && l.precioMostrado !== pv.centavos) throw fallo('precio-alterado');
      const series = l.series ?? [];
      if (p.conSerie) {
        if (series.length !== l.cantidad || new Set(series).size !== series.length) throw fallo('series-invalidas');
      } else if (series.length > 0) throw fallo('series-invalidas');
      lineas.push({ productoId: p.id, nombre: p.nombre, cantidad: l.cantidad, precioUnitario: pv.centavos, almacenId: alm, series: [...series], ...(p.garantiaMeses !== undefined ? { garantiaMeses: p.garantiaMeses } : {}) });
    }
    const subtotal = lineas.reduce((s, l) => s + l.cantidad * l.precioUnitario, 0);
    let descuento: VentaPos['descuento'];
    let aprobDesc: AprobacionPos | undefined;
    if (k.descuento !== undefined) {
      const { monto, motivo } = k.descuento;
      exigirMonto(monto, 'descuento', 1);
      exigirTexto(motivo, 'El motivo del descuento');
      if (monto >= subtotal) throw fallo('entrada-invalida', 'El descuento debe ser menor que el subtotal');
      if (monto * 10000 > c.e.configPos.topesDescuentoBp[c.rol] * subtotal) {
        if (e.aprobacionId === undefined) throw fallo('descuento-sin-aprobacion');
        aprobDesc = usarAprobacion(c, e.aprobacionId, { tipo: 'descuento', moneda: k.moneda, monto });
        descuento = { monto, motivo: motivo.trim(), aprobadoPor: aprobDesc.aprobadoPor ?? '', aprobacionId: e.aprobacionId };
      } else descuento = { monto, motivo: motivo.trim() };
    }
    const total = subtotal - (descuento?.monto ?? 0);
    if (k.totalMostrado !== undefined && k.totalMostrado !== total) throw fallo('precio-alterado');
    const pagos = validarPagos(c, e.pagos, k.moneda, total);
    const pagoCredito = pagos.find((p) => p.medio === 'credito');
    let aprobCred: AprobacionPos | undefined;
    let creditoAprobadoPor = c.uid;
    if (pagoCredito !== undefined) {
      if (k.cliente === undefined) throw fallo('pagos-invalidos', 'El crédito exige el nombre del deudor');
      if (c.rol === 'caj') {
        if (e.aprobacionCreditoId === undefined) throw fallo('aprobacion-inexistente', 'El crédito necesita aprobación');
        aprobCred = usarAprobacion(c, e.aprobacionCreditoId, { tipo: 'credito', moneda: k.moneda, monto: pagoCredito.monto, deudor: k.cliente.nombre });
        creditoAprobadoPor = aprobCred.aprobadoPor ?? '';
      }
    }
    // Stock (todo o nada).
    for (const l of lineas) {
      const p = c.e.productos.get(l.productoId);
      if (p === undefined) continue;
      if (p.stockTotal !== undefined && p.existencias[l.almacenId as keyof typeof p.existencias] < l.cantidad) {
        throw fallo('stock-insuficiente', 'Stock insuficiente', { faltantes: [{ productoId: l.productoId, almacenId: l.almacenId, pedido: l.cantidad, disponible: p.existencias[l.almacenId as keyof typeof p.existencias] }] });
      }
      for (const s of l.series) {
        const u = c.e.unidades.get(`${l.productoId}__${s}`);
        if (u === undefined || u.estado !== 'disponible' || u.ubicacionId !== l.almacenId) throw fallo('serie-no-disponible');
      }
    }
    const serie = c.e.configPos.serieRecibo;
    const receiptNo = (c.e.contadorRecibo.get(serie) ?? 0) + 1;
    c.e.contadorRecibo.set(serie, receiptNo);
    for (const l of lineas) {
      const p = c.e.productos.get(l.productoId);
      if (p === undefined) continue;
      if (p.stockTotal !== undefined) {
        p.existencias[l.almacenId as keyof typeof p.existencias] -= l.cantidad;
        recalcular(p);
      }
      for (const s of l.series) {
        const u = c.e.unidades.get(`${l.productoId}__${s}`);
        if (u !== undefined) c.e.unidades.set(`${l.productoId}__${s}`, { ...u, estado: 'vendida', ventaRef: ventaId });
      }
      c.e.movimientos.push({
        id: `${ventaId}__${l.productoId}__${l.almacenId}`, operacionId: `venta-${ventaId}`, productoId: l.productoId, ubicacionId: l.almacenId as never,
        tipo: 'venta', delta: -l.cantidad, saldoUbicacion: p?.existencias[l.almacenId as keyof typeof p.existencias] ?? 0, series: l.series, referencia: ventaId, por: c.uid, rol: c.rol, fecha: iso(c.ahora),
      });
    }
    if (aprobDesc !== undefined) c.e.aprobaciones.set(aprobDesc.aprobacionId, { ...aprobDesc, estado: 'usada' });
    if (aprobCred !== undefined) c.e.aprobaciones.set(aprobCred.aprobacionId, { ...aprobCred, estado: 'usada' });
    const venta: VentaPos = {
      ventaId, turnoId: turno.turnoId, cajaId: turno.cajaId, cajeroUid: c.uid, estado: 'confirmada', moneda: k.moneda, mercado: k.mercado,
      cotizacion: cot === null ? null : { cotizacionId: cot.cotizacionId, par: cot.par, valor: cot.valor, fecha: cot.fecha, fuente: cot.fuente as never, estado: cot.estado },
      lineas, subtotal, ...(descuento ? { descuento } : {}), total, pagos, ...(k.cliente ? { cliente: k.cliente } : {}), serie, receiptNo, creadoEnMs: c.ahora,
    };
    c.e.ventas.set(ventaId, venta);
    let t = turno;
    for (const p of pagos) {
      const neto = p.monto - (p.cambio ?? 0);
      t = agregarMonedas(t, { [venta.moneda]: p.medio === 'efectivo' ? { efectivo: neto } : p.medio === 'qr' ? { qr: neto } : p.medio === 'transferencia' ? { transferencia: neto } : { credito: neto } });
    }
    c.e.turnos.set(t.turnoId, t);
    if (pagoCredito !== undefined && k.cliente !== undefined) {
      c.e.creditos.set(ventaId, {
        ventaId, deudor: k.cliente.nombre.trim(), moneda: venta.moneda, monto: pagoCredito.monto, saldo: pagoCredito.monto, cobrado: 0, estado: 'pendiente',
        aprobadoPor: creditoAprobadoPor, turnoId: turno.turnoId, creadoEnMs: c.ahora, cobrosPorMedio: {},
      });
    }
    emitirRecibo(c, venta);
    auditar(c, 'pos.venta.confirmar', `ventas/${ventaId}`, descuento?.motivo);
    return { venta, repetida: false };
  },

  solicitarAprobacion(c, e) {
    const id = exigirUuid(e.aprobacionId, 'aprobacionId');
    const previa = c.e.aprobaciones.get(id);
    if (previa !== undefined) return previa;
    const s = e.solicitud;
    exigirMonto(s.monto, 'monto', 1);
    exigirTexto(s.motivo, 'motivo');
    if (s.tipo === 'credito') exigirTexto(s.deudor ?? '', 'deudor');
    const a: AprobacionPos = {
      aprobacionId: id, tipo: s.tipo, estado: 'pendiente', moneda: s.moneda, monto: s.monto, motivo: s.motivo.trim(),
      ...(s.deudor !== undefined ? { deudor: s.deudor.trim() } : {}), solicitadoPor: c.uid, solicitadoEnMs: c.ahora,
    };
    c.e.aprobaciones.set(id, a);
    auditar(c, 'pos.aprobacion.solicitar', `aprobaciones/${id}`, a.motivo);
    return a;
  },

  resolverAprobacion(c, e) {
    const a = c.e.aprobaciones.get(exigirUuid(e.aprobacionId, 'aprobacionId'));
    if (a === undefined) throw fallo('aprobacion-inexistente');
    if (a.estado !== 'pendiente') throw fallo('estado', 'La aprobación ya fue resuelta');
    if (a.solicitadoPor === c.uid) throw fallo('autoaprobacion');
    const n: AprobacionPos = e.decision === 'aprobar' ? { ...a, estado: 'aprobada', aprobadoPor: c.uid, aprobadoRol: c.rol } : { ...a, estado: 'rechazada', aprobadoPor: c.uid, aprobadoRol: c.rol };
    c.e.aprobaciones.set(a.aprobacionId, n);
    auditar(c, `pos.aprobacion.${e.decision}`, `aprobaciones/${a.aprobacionId}`);
    return n;
  },

  solicitarAnulacion(c, e) {
    const v = c.e.ventas.get(exigirUuid(e.ventaId, 'ventaId'));
    if (v === undefined) throw fallo('venta-inexistente');
    if (v.estado === 'anulada') throw fallo('venta-ya-anulada');
    if (c.rol === 'caj' && v.cajeroUid !== c.uid) throw fallo('no-autorizado');
    const n: VentaPos = { ...v, solicitudAnulacion: { por: c.uid, motivo: exigirTexto(e.motivo, 'motivo'), enMs: c.ahora } };
    c.e.ventas.set(v.ventaId, n);
    auditar(c, 'pos.anulacion.solicitar', `ventas/${v.ventaId}`, e.motivo);
    return n;
  },

  aprobarAnulacion(c, e) {
    const v = c.e.ventas.get(exigirUuid(e.ventaId, 'ventaId'));
    if (v === undefined) throw fallo('venta-inexistente');
    if (v.estado === 'anulada') throw fallo('venta-ya-anulada');
    if (v.solicitudAnulacion === undefined) throw fallo('anulacion-sin-solicitud');
    exigirTexto(e.motivo, 'motivo');
    if (v.solicitudAnulacion.por === c.uid || v.cajeroUid === c.uid) throw fallo('autoaprobacion', 'Nadie puede aprobar la anulación de una venta que vendió o que solicitó anular');
    const turno = turnoAbierto(c);
    if (turno === undefined) throw fallo('sin-turno', 'Abra un turno para registrar el reembolso');
    // Reembolso por los medios con que se cobró (netos de cambio, más cobros de crédito).
    const porMedio: Record<string, number> = {};
    for (const p of v.pagos) if (p.medio !== 'credito') porMedio[p.medio] = (porMedio[p.medio] ?? 0) + p.monto - (p.cambio ?? 0);
    const cred = c.e.creditos.get(v.ventaId);
    if (cred !== undefined) for (const [m, x] of Object.entries(cred.cobrosPorMedio)) porMedio[m] = (porMedio[m] ?? 0) + x;
    const reembolsos = (['efectivo', 'qr', 'transferencia'] as const).filter((m) => (porMedio[m] ?? 0) > 0).map((m) => ({ medio: m, moneda: v.moneda, monto: porMedio[m] ?? 0 }));
    const efectivo = reembolsos.find((r) => r.medio === 'efectivo');
    const t = turno.totales[v.moneda] ?? TOTALES_VACIOS;
    if (efectivo !== undefined && efectivoEsperado(turno.apertura[v.moneda] ?? 0, t) < efectivo.monto) throw fallo('egreso-excede-efectivo', 'El reembolso en efectivo supera el efectivo de esa moneda en la caja');
    let nt = turno;
    for (const r of reembolsos) nt = agregarMonedas(nt, { [v.moneda]: r.medio === 'efectivo' ? { efectivo: -r.monto } : r.medio === 'qr' ? { qr: -r.monto } : { transferencia: -r.monto } });
    if (cred !== undefined) {
      nt = agregarMonedas(nt, { [v.moneda]: { credito: -(cred.monto) } });
      c.e.creditos.set(v.ventaId, { ...cred, estado: 'anulado' });
    }
    c.e.turnos.set(nt.turnoId, nt);
    c.e.ventas.set(v.ventaId, { ...v, estado: 'anulada' });
    // Revierte stock y series.
    for (const l of v.lineas) {
      const p = c.e.productos.get(l.productoId);
      if (p?.stockTotal !== undefined) {
        p.existencias[l.almacenId as keyof typeof p.existencias] += l.cantidad;
        recalcular(p);
      }
      for (const s of l.series) {
        const u = c.e.unidades.get(`${l.productoId}__${s}`);
        if (u !== undefined) {
          c.e.unidades.set(`${l.productoId}__${s}`, { productoId: u.productoId, serie: u.serie, ubicacionId: u.ubicacionId, estado: 'disponible' });
        }
      }
    }
    const r = c.e.recibos.get(`recibo-${v.ventaId}`);
    if (r !== undefined) {
      c.e.recibos.set(r.reciboId, { ...r, estado: 'ANULADO', anulacion: { motivo: v.solicitudAnulacion.motivo, anuladaPor: v.solicitudAnulacion.por, aprobadoPor: c.uid, anuladoEn: iso(c.ahora) } });
    }
    auditar(c, 'pos.anulacion.aprobar', `ventas/${v.ventaId}`, v.solicitudAnulacion.motivo);
    return { ventaId: v.ventaId, reembolsos, turnoIdReembolso: turno.turnoId };
  },

  registrarMovimientoCaja(c, e) {
    const id = exigirUuid(e.requestId, 'requestId');
    const previo = c.e.movCaja.get(id);
    if (previo !== undefined) return { movimiento: previo, repetido: true };
    const m = e.movimiento;
    if (m.tipo !== 'ingreso' && m.tipo !== 'egreso') throw fallo('entrada-invalida', 'tipo inválido');
    exigirMonto(m.monto, 'monto', 1);
    exigirTexto(m.motivo, 'motivo');
    const turno = turnoAbierto(c);
    if (turno === undefined) throw fallo('sin-turno');
    mismoTurno(c, turno);
    const t = turno.totales[m.moneda] ?? TOTALES_VACIOS;
    if (m.tipo === 'egreso' && efectivoEsperado(turno.apertura[m.moneda] ?? 0, t) < m.monto) throw fallo('egreso-excede-efectivo');
    c.e.turnos.set(turno.turnoId, agregarMonedas(turno, { [m.moneda]: m.tipo === 'ingreso' ? { ingresos: m.monto } : { egresos: m.monto } }));
    const mov: MovimientoCaja = { ...m, motivo: m.motivo.trim(), requestId: id, turnoId: turno.turnoId, registradoPor: c.uid, creadoEnMs: c.ahora };
    c.e.movCaja.set(id, mov);
    auditar(c, `pos.caja.${m.tipo}`, `movimientos_caja/${id}`, m.motivo);
    return { movimiento: mov, repetido: false };
  },

  cobrarCredito(c, e) {
    const id = exigirUuid(e.requestId, 'requestId');
    const previo = c.e.cobros.get(id);
    if (previo !== undefined) return { cobro: previo, repetido: true };
    const cr = c.e.creditos.get(exigirUuid(e.ventaId, 'ventaId'));
    if (cr === undefined) throw fallo('credito-inexistente');
    const cb = e.cobro;
    if (!['efectivo', 'qr', 'transferencia'].includes(cb.medio)) throw fallo('entrada-invalida', 'Medio de cobro inválido');
    exigirMonto(cb.monto, 'monto', 1);
    if (cb.medio === 'qr' && (cb.referencia ?? '').trim() === '') throw fallo('entrada-invalida', 'El QR necesita la referencia');
    if (cb.monto > cr.saldo) throw fallo('credito-saldo-insuficiente');
    const turno = turnoAbierto(c);
    if (turno === undefined) throw fallo('sin-turno');
    mismoTurno(c, turno);
    c.e.turnos.set(turno.turnoId, agregarMonedas(turno, { [cr.moneda]: cb.medio === 'efectivo' ? { efectivo: cb.monto } : cb.medio === 'qr' ? { qr: cb.monto } : { transferencia: cb.monto } }));
    const saldo = cr.saldo - cb.monto;
    c.e.creditos.set(cr.ventaId, { ...cr, saldo, cobrado: cr.cobrado + cb.monto, estado: saldo === 0 ? 'cobrado' : 'pendiente', cobrosPorMedio: { ...cr.cobrosPorMedio, [cb.medio]: (cr.cobrosPorMedio[cb.medio] ?? 0) + cb.monto } });
    const cobro = { ...cb, requestId: id, ventaId: cr.ventaId, turnoId: turno.turnoId, moneda: cr.moneda, registradoPor: c.uid, creadoEnMs: c.ahora };
    c.e.cobros.set(id, cobro);
    auditar(c, 'pos.credito.cobrar', `cobros_credito/${id}`);
    return { cobro, repetido: false };
  },

  guardarConfigPos(c, e) {
    const k = e.config;
    if (k.negocio.nombre.trim() === '') throw fallo('entrada-invalida', 'El nombre del negocio es obligatorio');
    if (!/^[A-Z0-9]{1,6}$/.test(k.serieRecibo)) throw fallo('entrada-invalida', 'Serie inválida');
    if (k.mediosHabilitados.length === 0) throw fallo('entrada-invalida', 'Habilite al menos un medio');
    for (const r of ['caj', 'sup', 'adm'] as const) {
      const v = k.topesDescuentoBp[r];
      if (!Number.isInteger(v) || v < 0 || v > 10000) throw fallo('entrada-invalida', 'Tope de descuento inválido');
    }
    c.e.configPos = k;
    auditar(c, 'pos.config.guardar', 'pos_config/main');
    return k;
  },

  leerConfigPos: (c) => c.e.configPos,
  turnoActual: (c) => {
    const t = turnoAbierto(c);
    return t !== undefined && (c.rol !== 'caj' || t.cajeroUid === c.uid) ? t : null;
  },
  listarTurnos: (c, e) =>
    [...c.e.turnos.values()]
      .filter((t) => (c.rol === 'caj' ? t.cajeroUid === c.uid : true))
      .filter((t) => (e.estado === undefined ? true : e.estado === 'abierto' ? t.estado === 'abierto' : t.estado !== 'abierto'))
      .sort((a, b) => b.abiertoEnMs - a.abiertoEnMs),
  listarVentas: (c, e) =>
    [...c.e.ventas.values()]
      .filter((v) => (c.rol === 'caj' ? v.cajeroUid === c.uid : true))
      .filter((v) => (e.turnoId === undefined ? true : v.turnoId === e.turnoId))
      .filter((v) => (e.desde === undefined ? true : fechaLaPaz(v.creadoEnMs) >= e.desde))
      .filter((v) => (e.hasta === undefined ? true : fechaLaPaz(v.creadoEnMs) <= e.hasta))
      .filter((v) => (e.conSolicitudAnulacion === true ? v.solicitudAnulacion !== undefined && v.estado === 'confirmada' : true))
      .sort((a, b) => b.creadoEnMs - a.creadoEnMs),
  listarAprobaciones: (c, e) =>
    [...c.e.aprobaciones.values()]
      .filter((a) => (c.rol === 'caj' ? a.solicitadoPor === c.uid : true))
      .filter((a) => (e.estado === undefined ? true : a.estado === e.estado))
      .sort((a, b) => b.solicitadoEnMs - a.solicitadoEnMs),
  listarMovimientosCaja: (c, e) => [...c.e.movCaja.values()].filter((m) => (e.turnoId === undefined ? true : m.turnoId === e.turnoId)).sort((a, b) => b.creadoEnMs - a.creadoEnMs),
  listarCreditos: (c, e) =>
    [...c.e.creditos.values()]
      .filter((x) => (c.rol !== 'caj' ? true : c.e.ventas.get(x.ventaId)?.cajeroUid === c.uid))
      .filter((x) => (e.estado === undefined ? true : x.estado === e.estado)).map((x) => ({ ventaId: x.ventaId, deudor: x.deudor, moneda: x.moneda, monto: x.monto, saldo: x.saldo, cobrado: x.cobrado, estado: x.estado, aprobadoPor: x.aprobadoPor, turnoId: x.turnoId, creadoEnMs: x.creadoEnMs })).sort((a, b) => b.creadoEnMs - a.creadoEnMs),
  exportarVentasCsv(c, e) {
    if (c.rol === 'caj') throw fallo('no-autorizado', 'Solo supervisores y administradores exportan ventas.');
    const filas = [...c.e.ventas.values()]
      .filter((v) => (e.desde === undefined ? true : fechaLaPaz(v.creadoEnMs) >= e.desde))
      .filter((v) => (e.hasta === undefined ? true : fechaLaPaz(v.creadoEnMs) <= e.hasta))
      .sort((a, b) => a.creadoEnMs - b.creadoEnMs)
      .map((v) => [v.ventaId, fechaLaPaz(v.creadoEnMs), v.estado, v.moneda, v.total, v.cajeroUid]);
    return { csv: aCsv(['ventaId', 'fecha', 'estado', 'moneda', 'total', 'cajeroUid'], filas), truncado: false };
  },
  listarAuditoria: (c, e) =>
    c.e.auditoria
      .filter((a) => (e.desde === undefined ? true : a.fecha.slice(0, 10) >= e.desde))
      .filter((a) => (e.hasta === undefined ? true : a.fecha.slice(0, 10) <= e.hasta))
      .filter((a) => (e.accion === undefined ? true : a.accion.includes(e.accion)))
      .filter((a) => (e.uid === undefined ? true : a.uid === e.uid))
      .slice(-(e.limite ?? 200))
      .reverse(),
};

function cerrar(c: Contexto, turnoId: string, contado: Partial<Record<Moneda, number>>, forzado: boolean, motivo?: string): ResultadoCierre {
  const t = c.e.turnos.get(exigirUuid(turnoId, 'turnoId'));
  if (t === undefined) throw fallo('sin-turno', 'El turno no existe');
  if (t.estado !== 'abierto') throw fallo('turno-no-abierto');
  if (!forzado && t.cajeroUid !== c.uid) throw fallo('turno-ajeno');
  const monedas = new Set<Moneda>([...monedasDelTurno(t), ...MONEDAS.filter((m) => contado[m] !== undefined)]);
  for (const m of monedas) {
    const v = contado[m];
    if (v === undefined) throw fallo('conteo-faltante');
    exigirMonto(v, `contado.${m}`);
  }
  const dif = diferenciaPorMoneda(t, contado);
  const esperado: Partial<Record<Moneda, number>> = {};
  const arqueo: ResultadoCierre['arqueo'] = {};
  for (const m of monedas) {
    const e = efectivoEsperado(t.apertura[m] ?? 0, t.totales[m] ?? TOTALES_VACIOS);
    esperado[m] = e;
    (arqueo as Partial<Record<Moneda, { esperado: number; contado: number; diferencia: number }>>)[m] = { esperado: e, contado: contado[m] ?? 0, diferencia: (contado[m] ?? 0) - e };
  }
  const cerrado: TurnoPos = {
    ...t, estado: forzado ? 'cerrado_forzado' : 'cerrado', cerradoEnMs: c.ahora, cerradoPor: c.uid, ...(motivo !== undefined ? { motivoCierre: motivo } : {}),
    contado, esperado, diferencia: dif,
  };
  c.e.turnos.set(t.turnoId, cerrado);
  auditar(c, forzado ? 'pos.turno.cerrar-forzado' : 'pos.turno.cerrar', `turnos/${t.turnoId}`, motivo);
  return { turno: cerrado, arqueo };
}
