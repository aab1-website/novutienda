// Traducción de los errores tipados de los módulos a códigos de `HttpsError`. Función pura (no importa
// firebase-functions): el borde de las funciones crea el `HttpsError` con lo que devuelve. Los mensajes de los
// errores tipados son aptos para el usuario (no llevan datos personales); cualquier otro error se reporta como
// `internal` sin detalle y el detalle técnico queda solo en el registro.
import { ErrorConsola } from '@novutienda/consola';
import { ErrorInventario, StockInsuficiente } from '@novutienda/inventarios';
import {
  CargaNoAutorizada, ContadorCorrupto, ErrorAuditoria, ErrorEvento, ErrorIdentidad, LimiteDelPlan, SaltoSinConfirmar,
  SinCotizacionUtilizable,
} from '@novutienda/nucleo';
import { ErrorPos, type CodigoErrorPos } from '@novutienda/pos';
import { AccionNoPermitida, ErrorRecibo, ReciboNoEncontrado } from '@novutienda/recibos';
import { VideoNoDisponible } from './procesador-medios.js';

export type CodigoHttps =
  | 'invalid-argument' | 'failed-precondition' | 'already-exists' | 'not-found' | 'permission-denied' | 'resource-exhausted'
  | 'unauthenticated' | 'aborted' | 'unavailable' | 'deadline-exceeded' | 'internal';

export interface ErrorTraducido {
  readonly code: CodigoHttps;
  readonly message: string;
  readonly details?: unknown;
  /** `true` si el error es del servidor (se registra con severidad de error). */
  readonly interno: boolean;
}

const POS: Readonly<Record<CodigoErrorPos, CodigoHttps>> = {
  'entrada-invalida': 'invalid-argument',
  'pagos-invalidos': 'invalid-argument',
  'conteo-faltante': 'invalid-argument',
  'series-invalidas': 'invalid-argument',
  'no-autorizado': 'permission-denied',
  'turno-ajeno': 'permission-denied',
  autoaprobacion: 'permission-denied',
  'dato-corrupto': 'internal',
  'sin-turno': 'not-found',
  'venta-inexistente': 'not-found',
  'aprobacion-inexistente': 'not-found',
  'credito-inexistente': 'not-found',
  'producto-inexistente': 'not-found',
  'request-en-uso': 'already-exists',
  'turno-ya-abierto': 'failed-precondition',
  'turno-no-abierto': 'failed-precondition',
  'precio-alterado': 'failed-precondition',
  'producto-inactivo': 'failed-precondition',
  'sin-precio': 'failed-precondition',
  'descuento-sin-aprobacion': 'failed-precondition',
  'aprobacion-no-aprobada': 'failed-precondition',
  'aprobacion-usada': 'failed-precondition',
  'aprobacion-vencida': 'failed-precondition',
  'aprobacion-no-coincide': 'failed-precondition',
  'medio-no-habilitado': 'failed-precondition',
  'egreso-excede-efectivo': 'failed-precondition',
  'venta-ya-anulada': 'failed-precondition',
  'anulacion-sin-solicitud': 'failed-precondition',
  'credito-saldo-insuficiente': 'failed-precondition',
};

const CONSOLA: Readonly<Record<ErrorConsola['codigo'], CodigoHttps>> = {
  'no-autorizado': 'permission-denied',
  'entrada-invalida': 'invalid-argument',
  'no-encontrado': 'not-found',
  conflicto: 'already-exists',
  limite: 'resource-exhausted',
  'cuota-excedida': 'resource-exhausted',
  'tipo-no-permitido': 'invalid-argument',
  estado: 'failed-precondition',
  'contador-corrupto': 'internal',
  procesamiento: 'failed-precondition',
  'no-disponible': 'unavailable',
};

const IDENTIDAD: Readonly<Record<ErrorIdentidad['codigo'], CodigoHttps>> = {
  'no-autorizado': 'permission-denied',
  anonimo: 'permission-denied',
  'entrada-invalida': 'invalid-argument',
  proveedor: 'failed-precondition',
  claim: 'failed-precondition',
  'correo-no-verificado': 'failed-precondition',
  jerarquia: 'permission-denied',
  'ultimo-adm': 'failed-precondition',
  'no-miembro': 'not-found',
  estado: 'internal',
  concurrencia: 'aborted',
};

const GENERICO = 'Error interno. Intente de nuevo; si persiste, avise a soporte.';

const ok = (code: CodigoHttps, message: string, details?: unknown): ErrorTraducido => ({
  code, message, ...(details !== undefined ? { details } : {}), interno: code === 'internal',
});

/** Traduce cualquier error. Nunca lanza; lo desconocido sale como `internal` sin mensaje técnico. */
export function traducirError(e: unknown): ErrorTraducido {
  if (e instanceof StockInsuficiente) return ok('failed-precondition', e.message, { faltantes: e.faltantes });
  if (e instanceof ErrorInventario) {
    const detalles = (e as { detalles?: readonly string[] }).detalles;
    return ok(e.codigo, e.message, detalles !== undefined && detalles.length > 0 ? { detalles } : undefined);
  }
  if (e instanceof ErrorPos) return ok(POS[e.codigo], e.message);
  if (e instanceof LimiteDelPlan) return ok('resource-exhausted', e.message, { clave: e.clave, tope: e.tope });
  if (e instanceof ErrorIdentidad) return ok(IDENTIDAD[e.codigo], e.codigo === 'estado' ? GENERICO : e.message);
  if (e instanceof ErrorConsola) {
    const code = CONSOLA[e.codigo];
    return code === 'internal' ? ok('internal', GENERICO) : ok(code, e.message, e.detalles.length > 0 ? { detalles: e.detalles } : undefined);
  }
  if (e instanceof ReciboNoEncontrado) return ok('not-found', e.message);
  if (e instanceof AccionNoPermitida) return ok('permission-denied', e.message);
  if (e instanceof ErrorRecibo) return ok('invalid-argument', e.message);
  if (e instanceof CargaNoAutorizada) return ok('permission-denied', e.message);
  if (e instanceof SaltoSinConfirmar) return ok('failed-precondition', e.message, { guardado: e.guardado, propuesto: e.propuesto, saltoMaximo: e.saltoMaximo });
  if (e instanceof SinCotizacionUtilizable) return ok('failed-precondition', e.message, { mercado: e.mercado });
  if (e instanceof VideoNoDisponible) return ok('unavailable', e.message);
  if (e instanceof ErrorEvento) return ok('invalid-argument', e.message);
  if (e instanceof ContadorCorrupto || e instanceof ErrorAuditoria) return ok('internal', GENERICO);
  const codigoGrpc = (e as { code?: unknown } | null)?.code;
  if (codigoGrpc === 10 || codigoGrpc === 'aborted') return ok('aborted', 'Conflicto de concurrencia; reintente la operación.');
  if (codigoGrpc === 4) return ok('deadline-exceeded', 'La operación tardó demasiado; reintente.');
  if (codigoGrpc === 14) return ok('unavailable', 'Servicio no disponible por un momento; reintente.');
  return ok('internal', GENERICO);
}
