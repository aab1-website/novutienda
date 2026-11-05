import {
  esTenantIdValido,
  leerCotizacion,
  publicarEvento,
  registrarAuditoria,
  type AlmacenCotizaciones,
  type BaseDatosIdentidad,
  type ConfigCotizacion,
  type CopiaCotizacion,
  type EsFeriado,
  type Mercado,
  type Redondeo,
  type Resumen,
  type SobreEvento,
  type TransaccionBandeja,
  type TransaccionIdentidad,
} from '@novutienda/nucleo';
import { ErrorPos } from './errores.js';
import type { PuertoCatalogo, PuertoInventarios } from './puertos.js';
import type { ActorPos } from './tipos.js';

/** Dependencias inyectadas de todas las operaciones del POS. */
export interface DepsPos {
  readonly db: BaseDatosIdentidad;
  readonly inventarios: PuertoInventarios;
  readonly catalogo: PuertoCatalogo;
  /**
   * Política de redondeo del precio final. La política está sin decidir: no hay valor por
   * defecto a propósito (lo exige `precioFinal`); el coordinador la cablea desde la decisión vigente.
   */
  readonly redondeo: Redondeo;
  /** Reloj en milisegundos (inyectable para pruebas). */
  readonly ahora?: () => number;
  readonly esFeriado?: EsFeriado;
  readonly configCotizacion?: Partial<ConfigCotizacion>;
  /** Vigencia de una aprobación de descuento o crédito, en ms (por defecto 15 minutos). */
  readonly vigenciaAprobacionMs?: number;
}

export const VIGENCIA_APROBACION_POR_DEFECTO_MS = 15 * 60 * 1000;
export const ahoraDe = (deps: DepsPos): number => (deps.ahora ?? Date.now)();

type Datos = Readonly<Record<string, unknown>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const esUuid = (x: unknown): x is string => typeof x === 'string' && UUID.test(x);

/** El requestId del cliente es el id del documento: debe ser un UUID. */
export function exigirUuid(x: unknown, nombre: string): string {
  if (!esUuid(x)) throw new ErrorPos('entrada-invalida', `${nombre} debe ser un UUID`);
  return x.toLowerCase();
}

export function exigirTenant(tenantId: unknown): string {
  if (!esTenantIdValido(tenantId)) throw new ErrorPos('entrada-invalida', 'tenantId inválido');
  return tenantId;
}

export function exigirActor(actor: ActorPos): ActorPos {
  const ok =
    typeof actor?.uid === 'string' && actor.uid.trim() !== '' && !actor.uid.includes('/') && ['caj', 'sup', 'adm'].includes(actor.rol);
  if (!ok) throw new ErrorPos('no-autorizado', 'Usuario o rol inválido');
  return actor;
}

export function exigirRol(actor: ActorPos, roles: readonly ActorPos['rol'][], accion: string): void {
  if (!roles.includes(actor.rol)) throw new ErrorPos('no-autorizado', `Su rol no permite ${accion}`);
}

export function exigirTexto(x: unknown, nombre: string, max = 200): string {
  if (typeof x !== 'string' || x.trim() === '' || x.length > max) {
    throw new ErrorPos('entrada-invalida', `${nombre} es obligatorio (texto de hasta ${max} caracteres)`);
  }
  return x.trim();
}

export function exigirCentavos(x: unknown, nombre: string, minimo = 0): number {
  if (typeof x !== 'number' || !Number.isSafeInteger(x) || x < minimo) {
    throw new ErrorPos('entrada-invalida', `${nombre} debe ser un entero de centavos${minimo > 0 ? ' positivo' : ' no negativo'}`);
  }
  return x;
}

// Rutas (todas bajo tenants/{t}/...).
export const rutaConfig = (t: string): string => `tenants/${t}/pos_config/main`;
export const rutaTurnoActivo = (t: string): string => `tenants/${t}/pos_config/turno_activo`;
export const rutaTurno = (t: string, id: string): string => `tenants/${t}/turnos/${id}`;
export const rutaVenta = (t: string, id: string): string => `tenants/${t}/ventas/${id}`;
export const rutaAnulacion = (t: string, id: string): string => `tenants/${t}/anulaciones/${id}`;
export const rutaAprobacion = (t: string, id: string): string => `tenants/${t}/aprobaciones_descuento/${id}`;
export const rutaMovimiento = (t: string, id: string): string => `tenants/${t}/movimientos_caja/${id}`;
export const rutaCredito = (t: string, id: string): string => `tenants/${t}/creditos/${id}`;
export const rutaCobroCredito = (t: string, id: string): string => `tenants/${t}/cobros_credito/${id}`;
/** El contador vive en `contadores` (colección del núcleo); aquí solo se escribe, por el servidor. */
export const rutaContadorRecibo = (t: string, serie: string): string => `tenants/${t}/contadores/recibo_${serie}`;

/** Número legible del recibo: serie y correlativo con ceros (A-000123). El POS es el único que numera. */
export const formatearNumeroRecibo = (serie: string, correlativo: number): string => `${serie}-${String(correlativo).padStart(6, '0')}`;

/** Lee un documento y exige que exista. */
export async function leerObligatorio(tx: TransaccionIdentidad, ruta: string): Promise<Datos | undefined> {
  const d = await tx.get(ruta);
  return d.existe ? d.data() : undefined;
}

/** Adaptador de solo lectura para `leerCotizacion`, dentro de la misma transacción. */
export function almacenDeTransaccion(tx: TransaccionIdentidad): AlmacenCotizaciones {
  return {
    leer: async (ruta) => {
      const d = await tx.get(ruta);
      return d.existe ? (d.data() ?? null) : null;
    },
    transaccion: () => Promise.reject(new Error('El POS solo lee la cotización; no la escribe')),
  };
}

export function cotizacionVigente(
  deps: DepsPos,
  tx: TransaccionIdentidad,
  tenantId: string,
  mercado: Mercado,
): Promise<CopiaCotizacion> {
  return leerCotizacion(almacenDeTransaccion(tx), mercado, ahoraDe(deps), {
    tenantId,
    ...(deps.configCotizacion !== undefined ? { config: deps.configCotizacion } : {}),
    ...(deps.esFeriado !== undefined ? { esFeriado: deps.esFeriado } : {}),
  });
}

/** La bandeja solo necesita `create` y la marca de tiempo; la transacción de identidad los tiene. */
export const bandejaDe = (tx: TransaccionIdentidad): TransaccionBandeja => ({
  create: (ruta, datos) => {
    tx.create(ruta, datos);
  },
  existe: async (ruta) => (await tx.get(ruta)).existe,
  marcaTiempoServidor: () => tx.marcaTiempoServidor(),
});

export function publicar(
  tx: TransaccionIdentidad,
  e: { tenantId: string; tipo: string; clave: string; ocurridoEnMs: number; datos: unknown },
): void {
  const evento: SobreEvento = {
    id: e.clave,
    tipo: e.tipo,
    version: 1,
    tenantId: e.tenantId,
    origen: 'pos',
    ocurridoEn: new Date(e.ocurridoEnMs).toISOString(),
    claveIdempotencia: e.clave,
    datos: e.datos,
  };
  publicarEvento(bandejaDe(tx), evento);
}

export function auditar(
  tx: TransaccionIdentidad,
  tenantId: string,
  actor: ActorPos,
  e: { accion: string; ruta: string; antes?: Resumen; despues?: Resumen; motivo?: string },
): void {
  registrarAuditoria(tx, {
    tenantId,
    uid: actor.uid,
    rol: actor.rol,
    accion: e.accion,
    ruta: e.ruta,
    ...(e.antes !== undefined ? { resumenAntes: e.antes } : {}),
    ...(e.despues !== undefined ? { resumenDespues: e.despues } : {}),
    ...(e.motivo !== undefined ? { motivo: e.motivo } : {}),
  });
}
