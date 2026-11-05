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
import { AccionNoPermitida, ErrorRecibo, PlantillaInvalida, ReciboNoEncontrado } from '@novutienda/recibos';
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

/** `ClaseCamelCase` → `clase-camel-case` (código de módulo en kebab-case a partir del nombre del error tipado). */
export const aKebab = (nombre: string): string => nombre.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** Código de módulo por defecto de un código HTTPS, para los errores que nacen en el borde (marco, autenticación). */
export const CODIGO_DE_BORDE: Readonly<Record<CodigoHttps, string>> = {
  'invalid-argument': 'solicitud-invalida',
  'failed-precondition': 'precondicion-fallida',
  'already-exists': 'ya-existe',
  'not-found': 'recurso-inexistente',
  'permission-denied': 'acceso-denegado',
  'resource-exhausted': 'limite-alcanzado',
  unauthenticated: 'no-autenticado',
  aborted: 'concurrencia',
  unavailable: 'no-disponible',
  'deadline-exceeded': 'tiempo-agotado',
  internal: 'error-interno',
};

/** Todo error lleva `details.codigo` (código del módulo en kebab-case): el panel mapea mensajes por ese código. */
const ok = (code: CodigoHttps, codigo: string, message: string, details?: Readonly<Record<string, unknown>>): ErrorTraducido => ({
  code, message, details: { ...details, codigo }, interno: code === 'internal',
});

/** Traduce cualquier error. Nunca lanza; lo desconocido sale como `internal` sin mensaje técnico. */
export function traducirError(e: unknown): ErrorTraducido {
  if (e instanceof StockInsuficiente) return ok('failed-precondition', 'stock-insuficiente', e.message, { faltantes: e.faltantes });
  if (e instanceof ErrorInventario) {
    const detalles = (e as { detalles?: readonly string[] }).detalles;
    // El código de módulo de Inventarios es el nombre de su error tipado (`SerieNoDisponible` → `serie-no-disponible`).
    return ok(e.codigo, aKebab(e.name === 'ErrorInventario' ? e.codigo : e.name), e.message, detalles !== undefined && detalles.length > 0 ? { detalles } : undefined);
  }
  if (e instanceof ErrorPos) return ok(POS[e.codigo], e.codigo, e.message);
  if (e instanceof LimiteDelPlan) return ok('resource-exhausted', 'limite-del-plan', e.message, { clave: e.clave, tope: e.tope });
  if (e instanceof ErrorIdentidad) return ok(IDENTIDAD[e.codigo], e.codigo, e.codigo === 'estado' ? GENERICO : e.message);
  if (e instanceof ErrorConsola) {
    const code = CONSOLA[e.codigo];
    return code === 'internal' ? ok('internal', e.codigo, GENERICO) : ok(code, e.codigo, e.message, e.detalles.length > 0 ? { detalles: e.detalles } : undefined);
  }
  if (e instanceof ReciboNoEncontrado) return ok('not-found', 'recibo-no-encontrado', e.message);
  if (e instanceof AccionNoPermitida) return ok('permission-denied', 'accion-no-permitida', e.message);
  if (e instanceof PlantillaInvalida) return ok('invalid-argument', 'plantilla-invalida', e.message);
  if (e instanceof ErrorRecibo) return ok('invalid-argument', 'recibo-invalido', e.message);
  if (e instanceof CargaNoAutorizada) return ok('permission-denied', 'carga-no-autorizada', e.message);
  if (e instanceof SaltoSinConfirmar) return ok('failed-precondition', 'salto-sin-confirmar', e.message, { guardado: e.guardado, propuesto: e.propuesto, saltoMaximo: e.saltoMaximo });
  if (e instanceof SinCotizacionUtilizable) return ok('failed-precondition', 'sin-cotizacion', e.message, { mercado: e.mercado });
  if (e instanceof VideoNoDisponible) return ok('unavailable', 'video-no-disponible', e.message);
  if (e instanceof ErrorEvento) return ok('invalid-argument', 'evento-invalido', e.message);
  if (e instanceof ContadorCorrupto || e instanceof ErrorAuditoria) return ok('internal', 'error-interno', GENERICO);
  const codigoGrpc = (e as { code?: unknown } | null)?.code;
  if (codigoGrpc === 10 || codigoGrpc === 'aborted') return ok('aborted', 'concurrencia', 'Conflicto de concurrencia; reintente la operación.');
  if (codigoGrpc === 4) return ok('deadline-exceeded', 'tiempo-agotado', 'La operación tardó demasiado; reintente.');
  if (codigoGrpc === 14) return ok('unavailable', 'no-disponible', 'Servicio no disponible por un momento; reintente.');
  return ok('internal', 'error-interno', GENERICO);
}
