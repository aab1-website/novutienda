/**
 * Almacenamiento POR TENANT: `tenants/{t}/cotizaciones/{BO|AR}` (valor vigente)
 * y `tenants/{t}/cotizaciones/{BO|AR}/historial/{cotizacionId}` (inmutable: solo
 * se crea). La colección `cotizaciones` es del manifiesto del núcleo, bajo el tenant.
 * Se escribe contra una interfaz mínima inyectable; el adaptador de Firestore
 * (transacción de firebase-admin) lo cablea quien lo use. `crear` debe fallar
 * si el documento ya existe.
 */
import { parDe, tieneTipoCambio, type ConfiguracionComercial } from '../tenant/mercados.js';
import { esTenantIdValido } from '../tenant/tenant.js';
import type { Rol } from '../registro/tipos.js';
import { anclaParaEscribir, decidirCotizacion, type Decision, type EntradaDecision } from './decidir.js';
import { diasEntre, diasHabilesEntre, hoyEn, type EsFeriado } from './fechas.js';
import { esFechaIso } from './texto.js';
import {
  COMERCIAL_LEGADO_TRES_MONEDAS, CONFIG_POR_DEFECTO, SinCotizacionUtilizable,
  type Ancla, type ConfigCotizacion, type CopiaCotizacion, type CotizacionGuardada, type FuenteCotizacion, type IdMercado, type OrigenCarga,
} from './tipos.js';

export type Documento = Readonly<Record<string, unknown>>;

export interface TransaccionCotizaciones {
  leer(ruta: string): Promise<Documento | null>;
  /** Crea o reemplaza el documento. */
  establecer(ruta: string, datos: Documento): void;
  /** Crea; falla si ya existe (historial inmutable). */
  crear(ruta: string, datos: Documento): void;
}

export interface AlmacenCotizaciones {
  leer(ruta: string): Promise<Documento | null>;
  transaccion<T>(fn: (tx: TransaccionCotizaciones) => Promise<T>): Promise<T>;
}

function tenantValido(tenantId: string): string {
  if (!esTenantIdValido(tenantId)) throw new RangeError('tenantId inválido');
  return tenantId;
}

/** `tenants/{t}/cotizaciones/{BO|AR}`. Lanza si el tenantId no es válido (no altera la ruta). */
export const rutaCotizacion = (tenantId: string, mercado: IdMercado): string => `tenants/${tenantValido(tenantId)}/cotizaciones/${mercado}`;
export const rutaHistorial = (tenantId: string, mercado: IdMercado, id: string): string => `${rutaCotizacion(tenantId, mercado)}/historial/${id}`;

/** Id del historial: determinista según mercado, fecha e instante de escritura. */
export const idCotizacion = (mercado: IdMercado, fecha: string, ahoraMs: number): string => `${mercado}-${fecha}-${ahoraMs}`;

export interface ResultadoEscritura {
  readonly decision: Decision;
  readonly escrita: CotizacionGuardada | null;
}

export interface OpcionesAlmacen {
  readonly tenantId: string;
  /** Declaración comercial del tenant (par y zona horaria de cada mercado); omitida = la del tenant de tres monedas (LEGADO). */
  readonly comercial?: ConfiguracionComercial;
}

/** Par `VENTA/BASE` del mercado; lanza si no existe o no tiene tipo de cambio (no hay cotización que guardar). */
function parDeMercado(c: ConfiguracionComercial, mercado: IdMercado): string {
  const par = parDe(c, mercado);
  if (par === null) throw new RangeError(`el mercado ${mercado} no está declarado o no tiene tipo de cambio`);
  return par;
}

/** Una corrida automática: lee lo guardado, decide y, si corresponde, escribe documento e historial en una transacción. */
export async function escribirCotizacion(
  almacen: AlmacenCotizaciones,
  entrada: Omit<EntradaDecision, 'actual'>,
  opciones: OpcionesAlmacen,
): Promise<ResultadoEscritura> {
  const ruta = rutaCotizacion(opciones.tenantId, entrada.mercado);
  const comercial = opciones.comercial ?? entrada.comercial ?? COMERCIAL_LEGADO_TRES_MONEDAS;
  return almacen.transaccion(async (tx) => {
    const actual = await tx.leer(ruta);
    const decision = decidirCotizacion({ ...entrada, comercial, actual });
    if (decision.accion !== 'escribir') return { decision, escrita: null };
    const escrita = armar(entrada.mercado, decision.nuevo, entrada.ahoraMs, comercial);
    guardar(tx, opciones.tenantId, escrita, actual, 'automatico');
    return { decision, escrita };
  });
}

/** Quien carga a mano: uid, rol en el tenant (o 'propietario' de la plataforma) y proveedor de la sesión. */
export interface ActorCarga {
  readonly uid: string;
  readonly rol: Rol | 'propietario';
  /** Proveedor de inicio de sesión: 'password' (personal del tenant) o 'google.com' (propietario). */
  readonly proveedor: string;
}

/** El actor no es administrador (con correo y contraseña) ni propietario. */
export class CargaNoAutorizada extends Error {
  constructor() {
    super('solo el administrador del tenant (correo y contraseña) o el propietario cargan una cotización a mano');
    this.name = 'CargaNoAutorizada';
  }
}

/** El valor se aparta del guardado más que el salto máximo y no se confirmó. */
export class SaltoSinConfirmar extends Error {
  constructor(readonly guardado: number, readonly propuesto: number, readonly saltoMaximo: number) {
    super(`el valor ${propuesto} se aparta más del ${saltoMaximo * 100} % de ${guardado}: hay que confirmarlo expresamente`);
    this.name = 'SaltoSinConfirmar';
  }
}

const esAutorizado = (a: ActorCarga): boolean =>
  (a.rol === 'adm' && a.proveedor === 'password') || (a.rol === 'propietario' && a.proveedor === 'google.com');

/**
 * Carga manual (corrección por una persona). Exige administrador del tenant
 * (sesión con contraseña) o propietario; `por` es el uid del actor. Valida
 * valor y fecha con la configuración recibida. Si el valor se aparta del
 * guardado más que `saltoMaximo`, exige `confirmarSalto: true`. Queda marcada
 * `origen: 'manual'` y las corridas automáticas no la pisan con fecha igual o anterior.
 */
export async function cargarManual(
  almacen: AlmacenCotizaciones,
  e: {
    mercado: IdMercado; valor: number; fecha: string; actor: ActorCarga; ahoraMs: number;
    /** Confirmación explícita de un salto mayor al máximo. */
    confirmarSalto?: boolean; config?: Partial<ConfigCotizacion>;
  },
  opciones: OpcionesAlmacen,
): Promise<CotizacionGuardada> {
  if (!esAutorizado(e.actor)) throw new CargaNoAutorizada();
  const cfg = { ...CONFIG_POR_DEFECTO, ...e.config };
  if (!Number.isFinite(e.valor) || e.valor <= 0) throw new RangeError('el valor debe ser un número positivo');
  if (!esFechaIso(e.fecha)) throw new RangeError('la fecha debe ser aaaa-mm-dd');
  if (e.actor.uid.trim() === '') throw new RangeError('hay que indicar quién carga');
  const comercial = opciones.comercial ?? COMERCIAL_LEGADO_TRES_MONEDAS;
  if (!tieneTipoCambio(comercial, e.mercado)) throw new RangeError(`el mercado ${e.mercado} no está declarado o no tiene tipo de cambio`);
  const adelanto = diasEntre(hoyEn(e.mercado, e.ahoraMs, comercial), e.fecha);
  if (adelanto > (cfg.futuroVigente ? cfg.diasFuturoMax : 0)) throw new RangeError('la fecha es futura');
  const ruta = rutaCotizacion(opciones.tenantId, e.mercado);
  return almacen.transaccion(async (tx) => {
    const actual = await tx.leer(ruta);
    const previo = actual?.['valor'];
    if (typeof previo === 'number' && previo > 0 && Math.abs(e.valor - previo) / previo > cfg.saltoMaximo && e.confirmarSalto !== true) {
      throw new SaltoSinConfirmar(previo, e.valor, cfg.saltoMaximo);
    }
    const escrita = armar(e.mercado, { valor: e.valor, fecha: e.fecha, fuente: 'manual', origen: 'manual', ancla: anclaParaEscribir(leerPrevio(actual), e.fecha) }, e.ahoraMs, comercial);
    guardar(tx, opciones.tenantId, escrita, actual, e.actor.uid);
    return escrita;
  });
}

function leerPrevio(d: Documento | null): { valor: number; fecha: string; ancla?: unknown } | null {
  if (!d) return null;
  const valor = d['valor'];
  const fecha = d['fecha'];
  return typeof valor === 'number' && valor > 0 && esFechaIso(fecha) ? { valor, fecha, ancla: d['ancla'] } : null;
}

function armar(
  mercado: IdMercado,
  n: { valor: number; fecha: string; fuente: FuenteCotizacion; origen: OrigenCarga; ancla: Ancla | null },
  ahoraMs: number,
  comercial: ConfiguracionComercial,
): CotizacionGuardada {
  return {
    cotizacionId: idCotizacion(mercado, n.fecha, ahoraMs), mercado, par: parDeMercado(comercial, mercado),
    valor: n.valor, fecha: n.fecha, fuente: n.fuente, origen: n.origen, actualizadoEn: new Date(ahoraMs).toISOString(), ancla: n.ancla,
  };
}

function guardar(tx: TransaccionCotizaciones, tenantId: string, c: CotizacionGuardada, actual: Documento | null, por: string): void {
  tx.establecer(rutaCotizacion(tenantId, c.mercado), { ...c });
  tx.crear(rutaHistorial(tenantId, c.mercado, c.cotizacionId), {
    ...c, por,
    antes: actual ? { valor: actual['valor'] ?? null, fecha: actual['fecha'] ?? null, fuente: actual['fuente'] ?? null } : null,
  });
}

/**
 * Lee la cotización que rige y le pone el estado. La antigüedad se cuenta en
 * días HÁBILES (lunes a viernes sin los feriados de `esFeriado`, calendario
 * inyectable; sin él solo se descuentan fines de semana). Lanza
 * `SinCotizacionUtilizable` si falta, está mal formada, tiene una fecha futura
 * que `futuroVigente`/`diasFuturoMax` no admiten o supera `diasLimite` días hábiles, o si el mercado no tiene
 * tipo de cambio. Sin `opciones.comercial` rige la declaración del tenant de tres monedas (LEGADO) y el par
 * se tipa como `Par`; con ella, como `string`.
 */
export function leerCotizacion(
  almacen: AlmacenCotizaciones,
  mercado: IdMercado,
  ahoraMs: number,
  opciones: { readonly tenantId: string; readonly config?: Partial<ConfigCotizacion>; readonly esFeriado?: EsFeriado },
): Promise<CopiaCotizacion>;
export function leerCotizacion(
  almacen: AlmacenCotizaciones,
  mercado: IdMercado,
  ahoraMs: number,
  opciones: OpcionesAlmacen & { readonly config?: Partial<ConfigCotizacion>; readonly esFeriado?: EsFeriado },
): Promise<CopiaCotizacion<string>>;
export async function leerCotizacion(
  almacen: AlmacenCotizaciones,
  mercado: IdMercado,
  ahoraMs: number,
  opciones: OpcionesAlmacen & { readonly config?: Partial<ConfigCotizacion>; readonly esFeriado?: EsFeriado },
): Promise<CopiaCotizacion<string>> {
  const cfg = { ...CONFIG_POR_DEFECTO, ...opciones.config };
  const comercial = opciones.comercial ?? COMERCIAL_LEGADO_TRES_MONEDAS;
  const par = parDe(comercial, mercado);
  if (par === null) throw new SinCotizacionUtilizable(mercado, 'el mercado no está declarado o no tiene tipo de cambio');
  const d = await almacen.leer(rutaCotizacion(opciones.tenantId, mercado));
  if (!d) throw new SinCotizacionUtilizable(mercado, 'no hay cotización cargada');
  const { valor, fecha, fuente, cotizacionId } = d;
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) throw new SinCotizacionUtilizable(mercado, 'valor ausente o inválido');
  if (!esFechaIso(fecha)) throw new SinCotizacionUtilizable(mercado, 'fecha ausente o mal formada');
  if (typeof cotizacionId !== 'string' || cotizacionId === '') throw new SinCotizacionUtilizable(mercado, 'cotizacionId ausente');
  if (fuente !== 'BCB' && fuente !== 'BNA' && fuente !== 'BCRA' && fuente !== 'manual') throw new SinCotizacionUtilizable(mercado, 'fuente ausente o desconocida');
  const hoy = hoyEn(mercado, ahoraMs, comercial);
  const adelanto = diasEntre(hoy, fecha);
  if (adelanto > 0) {
    if (!cfg.futuroVigente || adelanto > cfg.diasFuturoMax) throw new SinCotizacionUtilizable(mercado, 'fecha futura');
    return { cotizacionId, par, valor, fecha, fuente, estado: 'vigente' };
  }
  const edad = diasHabilesEntre(fecha, hoy, mercado, opciones.esFeriado);
  if (edad > cfg.diasLimite) throw new SinCotizacionUtilizable(mercado, `la cotización tiene más de ${cfg.diasLimite} días hábiles (${fecha})`);
  return { cotizacionId, par, valor, fecha, fuente, estado: edad <= cfg.diasVigente ? 'vigente' : 'ultimo_verificado' };
}
