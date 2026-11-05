import {
  consumir, publicarEvento, registrarAuditoria, validarEvento,
  type DatosReciboEmitidoV1, type DatosVentaAnuladaV1, type DatosVentaConfirmadaV1, type SobreEvento,
} from '@novutienda/nucleo';
import { ErrorRecibo } from './errores.js';
import { plantillaVigente } from './plantilla.js';
import { reciboIdDe, rutaAnulacionPendiente, rutaPlantilla, rutaRecibo } from './rutas.js';
import type { AnulacionRecibo, EjecutorRecibos, LineaRecibo, Recibo, TransaccionRecibos } from './tipos.js';

export const CONSUMIDOR_RECIBOS = 'recibos';
export const ZONA_HORARIA_POR_DEFECTO = 'America/La_Paz';
/** El evento no trae el rol del aprobador y el núcleo exige un Rol; se usa el mínimo que puede aprobar (sup), sin presentarlo como dato del evento. */
const ROL_APROBADOR = 'sup';

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

function anulacionDePendiente(p: Readonly<Record<string, unknown>>): AnulacionRecibo {
  const t = (k: string): string => {
    const v = p[k];
    if (typeof v !== 'string' || v === '') throw new ErrorRecibo(`Anulación pendiente corrupta: falta ${k}`);
    return v;
  };
  return { motivo: t('motivo'), anuladaPor: t('anuladaPor'), aprobadoPor: t('aprobadoPor'), anuladoEn: t('anuladoEn') };
}

function lineasDe(d: DatosVentaConfirmadaV1, fecha: string): LineaRecibo[] {
  return d.lineas.map((l) => ({
    productoId: l.productoId,
    nombre: l.nombre,
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
  // El número lo asignó el POS dentro de la transacción de la venta: aquí no se numera.
  const numero = d.numeroRecibo;
  // Si la anulación llegó antes que la venta, el recibo nace ANULADO.
  const pendiente = await tx.leer(rutaAnulacionPendiente(tenantId, d.ventaId));
  const anulacion = pendiente === undefined ? undefined : anulacionDePendiente(pendiente);
  const fecha = fechaLocal(evento.ocurridoEn, opciones.zonaHoraria ?? ZONA_HORARIA_POR_DEFECTO);
  const lineas = lineasDe(d, fecha);

  const recibo: Recibo = {
    reciboId, tenantId, ventaId: d.ventaId, numero,
    estado: anulacion === undefined ? 'EMITIDO' : 'ANULADO', fecha, emitidoEn: evento.ocurridoEn, moneda: d.moneda, total: d.total,
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
    ...(anulacion !== undefined && { anulacion }),
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
    // El evento no trae el rol de quien vendió y el núcleo exige un Rol; 'caj' es el rol mínimo, no un dato del evento.
    tenantId, uid: d.cajeroUid, rol: 'caj', accion: 'recibos.emitir', ruta,
    resumenDespues: { ventaId: d.ventaId, numero, estado: recibo.estado },
  });
}

function exigirTipo(evento: SobreEvento, tipo: string): void {
  const v = validarEvento(evento);
  if (!v.ok) throw new ErrorRecibo(v.error);
  if (evento.tipo !== tipo) throw new ErrorRecibo(`Se esperaba ${tipo} y llegó ${evento.tipo}`);
}

/**
 * Consume `venta.confirmada`: arma el comprobante solo con el evento. El procesado
 * (por id y por clave de idempotencia), el comprobante y `recibo.emitido`
 * van en una sola transacción: reintentar el mismo evento no genera otro comprobante. El número es el del evento (lo asigna el POS).
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
  const anuladoEn = (opciones.ahora ?? ((): string => new Date().toISOString()))();
  const anulacion: AnulacionRecibo = { motivo: d.motivo, anuladaPor: d.anuladaPor, aprobadoPor: d.aprobadoPor, anuladoEn };
  if (actual === undefined) {
    // La anulación llegó antes que la venta: se guarda sin fallar; el recibo se emitirá ANULADO.
    const rutaPend = rutaAnulacionPendiente(evento.tenantId, d.ventaId);
    if ((await tx.leer(rutaPend)) !== undefined) return;
    tx.create(rutaPend, { ventaId: d.ventaId, ...anulacion, creadoEn: tx.marcaTiempoServidor() });
    registrarAuditoria(tx, {
      tenantId: evento.tenantId,
      uid: d.aprobadoPor,
      rol: ROL_APROBADOR,
      accion: 'recibos.anulacion-pendiente',
      ruta: rutaPend,
      motivo: d.motivo,
    });
    return;
  }
  if (actual['estado'] === 'ANULADO') return;
  // Se marca; el comprobante no se borra ni se renumera.
  tx.actualizar(ruta, { estado: 'ANULADO', anulacion });
  registrarAuditoria(tx, {
    tenantId: evento.tenantId,
    uid: d.aprobadoPor,
    rol: ROL_APROBADOR,
    accion: 'recibos.anular',
    ruta,
    resumenAntes: { estado: 'EMITIDO' },
    resumenDespues: { estado: 'ANULADO' },
    motivo: d.motivo,
  });
}

/** Consume `venta.anulada`: marca el comprobante ANULADO sin borrarlo; si la venta aún no llegó, registra la anulación pendiente. Idempotente. */
export function manejarVentaAnulada(ejecutor: EjecutorRecibos, evento: SobreEvento, opciones: OpcionesEmision = {}): Promise<boolean> {
  exigirTipo(evento, 'venta.anulada');
  return consumir(ejecutor, {
    consumidor: CONSUMIDOR_RECIBOS,
    evento,
    manejador: (tx, e) => anularDesdeEvento(tx, e, opciones),
  });
}
