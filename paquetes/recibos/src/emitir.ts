import {
  consumir, publicarEvento, registrarAuditoria, validarEvento,
  type DatosReciboEmitidoV1, type DatosVentaAnuladaV1, type DatosVentaConfirmadaV1, type SobreEvento,
} from '@plataforma/nucleo';
import { ContadorReciboCorrupto, ErrorRecibo, ReciboNoEncontrado } from './errores.js';
import { plantillaVigente } from './plantilla.js';
import { reciboIdDe, rutaContadorSerie, rutaPlantilla, rutaRecibo } from './rutas.js';
import type { EjecutorRecibos, LineaRecibo, Recibo, TransaccionRecibos } from './tipos.js';

export const CONSUMIDOR_RECIBOS = 'recibos';
export const ZONA_HORARIA_POR_DEFECTO = 'America/La_Paz';

export interface OpcionesEmision {
  /** Reloj inyectable (ISO 8601 UTC) para el instante de emisión del evento `recibo.emitido`. */
  readonly ahora?: () => string;
  /** Zona horaria del tenant para la fecha del comprobante y el cálculo de la garantía. */
  readonly zonaHoraria?: string;
}

/** Fecha aaaa-mm-dd de un instante en la zona dada. */
export function fechaLocal(instanteIso: string, zona: string): string {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(
    new Date(instanteIso),
  );
  const g = (t: string): string => partes.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

/** Suma meses a una fecha aaaa-mm-dd; si el día no existe en el mes destino, usa el último día. */
export function sumarMeses(fecha: string, meses: number): string {
  const [a, m, d] = fecha.split('-').map(Number) as [number, number, number];
  const indice = a * 12 + (m - 1) + meses;
  const anio = Math.floor(indice / 12);
  const mes = (indice % 12) + 1;
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const dd = Math.min(d, ultimo);
  return `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

export const formatearNumero = (serie: string, correlativo: number): string => `${serie}-${String(correlativo).padStart(6, '0')}`;

/** Reserva el siguiente correlativo de la serie dentro de la transacción (sin saltos: si la transacción falla, no se consume). */
async function reservarCorrelativo(tx: TransaccionRecibos, tenantId: string, serie: string): Promise<number> {
  const ruta = rutaContadorSerie(tenantId, serie);
  const doc = await tx.leer(ruta);
  let ultimo = 0;
  if (doc !== undefined) {
    const v = doc['ultimo'];
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw new ContadorReciboCorrupto(`Contador corrupto en la serie ${serie}`);
    ultimo = v;
  }
  tx.set(ruta, { ultimo: ultimo + 1 });
  return ultimo + 1;
}

function lineasDe(d: DatosVentaConfirmadaV1, fecha: string): LineaRecibo[] {
  return d.lineas.map((l) => ({
    productoId: l.productoId,
    cantidad: l.cantidad,
    precioUnitario: l.precioUnitario,
    subtotal: l.cantidad * l.precioUnitario,
    series: [...l.series],
    ...(l.garantiaMeses !== undefined && { garantiaMeses: l.garantiaMeses, garantiaHasta: sumarMeses(fecha, l.garantiaMeses) }),
  }));
}

async function emitirDesdeEvento(tx: TransaccionRecibos, evento: SobreEvento, opciones: OpcionesEmision): Promise<void> {
  const d = evento.datos as DatosVentaConfirmadaV1;
  const tenantId = evento.tenantId;
  const reciboId = reciboIdDe(d.ventaId);
  const ruta = rutaRecibo(tenantId, reciboId);
  // Red de seguridad: aunque el procesado ya deduplica, un comprobante existente nunca se reemite.
  if ((await tx.leer(ruta)) !== undefined) return;

  const plantilla = plantillaVigente(await tx.leer(rutaPlantilla(tenantId)));
  const correlativo = await reservarCorrelativo(tx, tenantId, plantilla.serie);
  const numero = formatearNumero(plantilla.serie, correlativo);
  const fecha = fechaLocal(evento.ocurridoEn, opciones.zonaHoraria ?? ZONA_HORARIA_POR_DEFECTO);
  const lineas = lineasDe(d, fecha);

  const recibo: Recibo = {
    reciboId, tenantId, ventaId: d.ventaId, numero, serie: plantilla.serie, correlativo,
    estado: 'EMITIDO', fecha, emitidoEn: evento.ocurridoEn, moneda: d.moneda, total: d.total,
    ...(d.descuento !== undefined && { descuento: { monto: d.descuento.monto, motivo: d.descuento.motivo } }),
    cotizacion: d.cotizacion,
    lineas,
    // Solo medio, moneda y monto: sin referencias, recibido ni cambio.
    pagos: d.pagos.map((p) => ({ medio: p.medio, moneda: p.moneda, monto: p.monto })),
    ...(d.cliente !== undefined && {
      cliente: { nombre: d.cliente.nombre, ...(d.cliente.telefono !== undefined && { telefono: d.cliente.telefono }) },
    }),
    plantilla,
    envioWhatsapp: { estado: 'no_enviado' },
  };
  tx.create(ruta, { ...recibo, creadoEn: tx.marcaTiempoServidor() });

  const garantias = lineas.flatMap((l) => (l.garantiaHasta === undefined ? [] : l.series.map((serie) => ({ serie, hasta: l.garantiaHasta as string }))));
  const datosEvento: DatosReciboEmitidoV1 = {
    reciboId, ventaId: d.ventaId, numero, garantias, envioWhatsapp: { estado: 'no_enviado' },
  };
  publicarEvento(tx, {
    id: `recibo-emitido-${d.ventaId}`,
    tipo: 'recibo.emitido',
    version: 1,
    tenantId,
    origen: 'recibos',
    ocurridoEn: (opciones.ahora ?? ((): string => new Date().toISOString()))(),
    claveIdempotencia: reciboId,
    datos: datosEvento,
  });
  registrarAuditoria(tx, {
    tenantId, uid: d.cajeroUid, rol: 'caj', accion: 'recibos.emitir', ruta,
    resumenDespues: { ventaId: d.ventaId, numero, estado: 'EMITIDO' },
  });
}

function exigirTipo(evento: SobreEvento, tipo: string): void {
  const v = validarEvento(evento);
  if (!v.ok) throw new ErrorRecibo(v.error);
  if (evento.tipo !== tipo) throw new ErrorRecibo(`Se esperaba ${tipo} y llegó ${evento.tipo}`);
}

/**
 * Consume `venta.confirmada`: arma el comprobante solo con el evento. El procesado
 * (por id y por clave de idempotencia), la numeración, el comprobante y `recibo.emitido`
 * van en una sola transacción: reintentar el mismo evento no genera otro número.
 * Devuelve `false` si era duplicado.
 */
export function manejarVentaConfirmada(ejecutor: EjecutorRecibos, evento: SobreEvento, opciones: OpcionesEmision = {}): Promise<boolean> {
  exigirTipo(evento, 'venta.confirmada');
  return consumir(ejecutor, {
    consumidor: CONSUMIDOR_RECIBOS,
    evento,
    manejador: (tx, e) => emitirDesdeEvento(tx, e, opciones),
  });
}

async function anularDesdeEvento(tx: TransaccionRecibos, evento: SobreEvento, opciones: OpcionesEmision): Promise<void> {
  const d = evento.datos as DatosVentaAnuladaV1;
  const ruta = rutaRecibo(evento.tenantId, reciboIdDe(d.ventaId));
  const actual = await tx.leer(ruta);
  if (actual === undefined) throw new ReciboNoEncontrado('La venta anulada aún no tiene comprobante');
  if (actual['estado'] === 'ANULADO') return;
  const anuladoEn = (opciones.ahora ?? ((): string => new Date().toISOString()))();
  // Se marca; el comprobante no se borra ni se renumera.
  tx.actualizar(ruta, {
    estado: 'ANULADO',
    anulacion: { motivo: d.motivo, anuladaPor: d.anuladaPor, aprobadoPor: d.aprobadoPor, anuladoEn },
  });
  registrarAuditoria(tx, {
    tenantId: evento.tenantId,
    uid: d.aprobadoPor,
    // El evento no trae el rol del aprobador; el supuesto vigente es que aprueba sup/adm.
    rol: 'sup',
    accion: 'recibos.anular',
    ruta,
    resumenAntes: { estado: 'EMITIDO' },
    resumenDespues: { estado: 'ANULADO' },
    motivo: d.motivo,
  });
}

/** Consume `venta.anulada`: marca el comprobante ANULADO sin borrarlo. Idempotente. */
export function manejarVentaAnulada(ejecutor: EjecutorRecibos, evento: SobreEvento, opciones: OpcionesEmision = {}): Promise<boolean> {
  exigirTipo(evento, 'venta.anulada');
  return consumir(ejecutor, {
    consumidor: CONSUMIDOR_RECIBOS,
    evento,
    manejador: (tx, e) => anularDesdeEvento(tx, e, opciones),
  });
}
