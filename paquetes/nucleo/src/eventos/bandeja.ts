import { validarEvento } from './contratos.js';
import type { SobreEvento } from '../contratos/sobre-evento.js';

/** Transacción mínima inyectable para la bandeja (la adapta firebase-admin en el borde). */
export interface TransaccionBandeja {
  /** Crea el documento; falla si ya existe. No hay `set`, `update` ni `delete`. */
  create(ruta: string, datos: Readonly<Record<string, unknown>>): void;
  existe(ruta: string): Promise<boolean>;
  /** Marca de tiempo asignada por el servidor al confirmar. */
  marcaTiempoServidor(): unknown;
}

/** Ejecutor de transacciones inyectable. */
export interface EjecutorTransacciones<T extends TransaccionBandeja = TransaccionBandeja> {
  transaccion<R>(fn: (tx: T) => Promise<R>): Promise<R>;
}

export class ErrorEvento extends Error {}

/** Separador de las partes de un id de procesado; el validador de segmentos no lo admite, así que no hay colisiones. */
const SEPARADOR = '~';
const SEGURO = /^[A-Za-z0-9._-]+$/;
/** Firestore reserva «.», «..» y los ids de forma `__x__`. */
const RESERVADO = /^(\.{1,2}|__.*__)$/;

function segmento(valor: string, nombre: string): string {
  if (!SEGURO.test(valor) || RESERVADO.test(valor)) throw new ErrorEvento(`${nombre} contiene caracteres no permitidos`);
  return valor;
}

export const rutaEvento = (tenantId: string, id: string): string =>
  `tenants/${segmento(tenantId, 'tenantId')}/eventos/${segmento(id, 'id')}`;

const procesados = (tenantId: string): string => `tenants/${segmento(tenantId, 'tenantId')}/procesados`;

/** Procesado por id de evento: `{consumidor}~id~{id}`. */
export const rutaProcesado = (tenantId: string, consumidor: string, id: string): string =>
  `${procesados(tenantId)}/${segmento(consumidor, 'consumidor')}${SEPARADOR}id${SEPARADOR}${segmento(id, 'id')}`;

/** Procesado por (tipo, claveIdempotencia): `{consumidor}~clave~{tipo}~{clave}`. */
export const rutaProcesadoPorClave = (tenantId: string, consumidor: string, tipo: string, clave: string): string =>
  `${procesados(tenantId)}/${segmento(consumidor, 'consumidor')}${SEPARADOR}clave${SEPARADOR}${segmento(tipo, 'tipo')}${SEPARADOR}${segmento(clave, 'claveIdempotencia')}`;

/** Un documento por intento fallido: `{consumidor}~fallo~{id}~{n}` (la bandeja solo crea, nunca actualiza). */
export const rutaFallo = (tenantId: string, consumidor: string, id: string, intento: number): string =>
  `${procesados(tenantId)}/${segmento(consumidor, 'consumidor')}${SEPARADOR}fallo${SEPARADOR}${segmento(id, 'id')}${SEPARADOR}${intento}`;

/** Registro de un evento que agotó sus reintentos: `{consumidor}~descartado~{id}`. */
export const rutaDescartado = (tenantId: string, consumidor: string, id: string): string =>
  `${procesados(tenantId)}/${segmento(consumidor, 'consumidor')}${SEPARADOR}descartado${SEPARADOR}${segmento(id, 'id')}`;

/** Publica el evento en la bandeja de salida dentro de la transacción del negocio. */
export function publicarEvento(tx: TransaccionBandeja, evento: SobreEvento): void {
  const v = validarEvento(evento);
  if (!v.ok) throw new ErrorEvento(v.error);
  segmento(evento.claveIdempotencia, 'claveIdempotencia');
  tx.create(rutaEvento(evento.tenantId, evento.id), { ...evento, publicadoEn: tx.marcaTiempoServidor() });
}

/** Tope de intentos fallidos por defecto antes de descartar un evento. */
export const MAX_INTENTOS_POR_DEFECTO = 5;

/**
 * Procesa el evento una sola vez por consumidor: el registro del procesado y los
 * efectos del manejador ocurren en la misma transacción. Deduplica por id y también
 * por (tipo, claveIdempotencia): el mismo hecho reenviado con otro id no se repite.
 *
 * Si el manejador falla, la transacción se revierte, se registra el intento en otra
 * transacción y se relanza el error (para que el bus reintente). Al llegar a
 * `maxIntentos` se registra el evento como «descartado» y se devuelve `false` sin relanzar,
 * de modo que un evento que siempre falla deja de reintentarse. El registro guarda solo el
 * nombre del error, nunca su mensaje ni los datos del evento (pueden contener datos personales).
 *
 * Devuelve `false` si era duplicado, estaba descartado o se descartó ahora.
 */
export async function consumir<T extends TransaccionBandeja>(
  ejecutor: EjecutorTransacciones<T>,
  opciones: {
    consumidor: string;
    evento: SobreEvento;
    manejador: (tx: T, evento: SobreEvento) => Promise<void>;
    maxIntentos?: number;
  },
): Promise<boolean> {
  const { consumidor, evento, manejador } = opciones;
  const maxIntentos = opciones.maxIntentos ?? MAX_INTENTOS_POR_DEFECTO;
  if (!Number.isInteger(maxIntentos) || maxIntentos < 1) throw new ErrorEvento('maxIntentos debe ser un entero positivo');
  const v = validarEvento(evento);
  if (!v.ok) throw new ErrorEvento(v.error);
  const rutaId = rutaProcesado(evento.tenantId, consumidor, evento.id);
  const rutaClave = rutaProcesadoPorClave(evento.tenantId, consumidor, evento.tipo, evento.claveIdempotencia);
  const rutaBaja = rutaDescartado(evento.tenantId, consumidor, evento.id);
  try {
    return await ejecutor.transaccion(async (tx) => {
      if ((await tx.existe(rutaId)) || (await tx.existe(rutaClave)) || (await tx.existe(rutaBaja))) return false;
      await manejador(tx, evento);
      const base = { consumidor, eventoId: evento.id, tipo: evento.tipo, procesadoEn: tx.marcaTiempoServidor() };
      tx.create(rutaId, base);
      tx.create(rutaClave, base);
      return true;
    });
  } catch (error) {
    const descartado = await registrarFallo(ejecutor, { consumidor, evento, maxIntentos, error });
    if (descartado) return false;
    throw error;
  }
}

/** Registra un intento fallido; si alcanza el tope registra el descarte. Devuelve `true` si se descartó. */
async function registrarFallo<T extends TransaccionBandeja>(
  ejecutor: EjecutorTransacciones<T>,
  p: { consumidor: string; evento: SobreEvento; maxIntentos: number; error: unknown },
): Promise<boolean> {
  const { consumidor, evento, maxIntentos } = p;
  const nombreError = p.error instanceof Error ? p.error.name : 'desconocido';
  return ejecutor.transaccion(async (tx) => {
    let intento = 1;
    while (await tx.existe(rutaFallo(evento.tenantId, consumidor, evento.id, intento))) intento++;
    tx.create(rutaFallo(evento.tenantId, consumidor, evento.id, intento), {
      consumidor, eventoId: evento.id, tipo: evento.tipo, intento, error: nombreError, fallidoEn: tx.marcaTiempoServidor(),
    });
    if (intento < maxIntentos) return false;
    tx.create(rutaDescartado(evento.tenantId, consumidor, evento.id), {
      consumidor, eventoId: evento.id, tipo: evento.tipo, intentos: intento, error: nombreError, descartadoEn: tx.marcaTiempoServidor(),
    });
    return true;
  });
}
