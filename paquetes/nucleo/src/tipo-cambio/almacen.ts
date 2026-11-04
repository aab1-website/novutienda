/**
 * Almacenamiento: `cotizaciones/{BO|AR}` (valor vigente) y
 * `cotizaciones/{BO|AR}/historial/{cotizacionId}` (inmutable: solo se crea).
 * Se escribe contra una interfaz mínima inyectable; el adaptador de Firestore
 * (transacción de firebase-admin) lo cablea quien lo use. `crear` debe fallar
 * si el documento ya existe.
 */
import { decidirCotizacion, type Decision, type EntradaDecision } from './decidir.js';
import { diasEntre, hoyEn } from './fechas.js';
import { esFechaIso } from './texto.js';
import {
  CONFIG_POR_DEFECTO, PAR_DE, SinCotizacionUtilizable,
  type ConfigCotizacion, type CopiaCotizacion, type CotizacionGuardada, type FuenteCotizacion, type Mercado, type OrigenCarga,
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

export const BASE_POR_DEFECTO = 'cotizaciones';

export const rutaCotizacion = (mercado: Mercado, base: string = BASE_POR_DEFECTO): string => `${base}/${mercado}`;
export const rutaHistorial = (mercado: Mercado, id: string, base: string = BASE_POR_DEFECTO): string =>
  `${base}/${mercado}/historial/${id}`;

/** Id del historial: determinista según mercado, fecha e instante de escritura. */
export const idCotizacion = (mercado: Mercado, fecha: string, ahoraMs: number): string => `${mercado}-${fecha}-${ahoraMs}`;

export interface ResultadoEscritura {
  readonly decision: Decision;
  readonly escrita: CotizacionGuardada | null;
}

export interface OpcionesAlmacen { readonly base?: string }

/** Una corrida automática: lee lo guardado, decide y, si corresponde, escribe documento e historial en una transacción. */
export async function escribirCotizacion(
  almacen: AlmacenCotizaciones,
  entrada: Omit<EntradaDecision, 'actual'>,
  opciones: OpcionesAlmacen & { readonly por?: string } = {},
): Promise<ResultadoEscritura> {
  const ruta = rutaCotizacion(entrada.mercado, opciones.base);
  return almacen.transaccion(async (tx) => {
    const actual = await tx.leer(ruta);
    const decision = decidirCotizacion({ ...entrada, actual });
    if (decision.accion !== 'escribir') return { decision, escrita: null };
    const escrita = armar(entrada.mercado, decision.nuevo, entrada.ahoraMs);
    guardar(tx, escrita, actual, opciones.por ?? 'automatico', opciones.base);
    return { decision, escrita };
  });
}

/**
 * Carga manual (corrección por una persona). Valida valor y fecha, pero no
 * aplica el umbral de salto: la persona asume el cambio. Queda marcada
 * `origen: 'manual'` y las corridas automáticas no la pisan con fecha igual o anterior.
 */
export async function cargarManual(
  almacen: AlmacenCotizaciones,
  e: { mercado: Mercado; valor: number; fecha: string; por: string; ahoraMs: number },
  opciones: OpcionesAlmacen = {},
): Promise<CotizacionGuardada> {
  if (!Number.isFinite(e.valor) || e.valor <= 0) throw new RangeError('el valor debe ser un número positivo');
  if (!esFechaIso(e.fecha)) throw new RangeError('la fecha debe ser aaaa-mm-dd');
  if (e.por.trim() === '') throw new RangeError('hay que indicar quién carga');
  if (diasEntre(hoyEn(e.mercado, e.ahoraMs), e.fecha) > CONFIG_POR_DEFECTO.diasFuturoMax) throw new RangeError('la fecha es futura');
  const ruta = rutaCotizacion(e.mercado, opciones.base);
  return almacen.transaccion(async (tx) => {
    const actual = await tx.leer(ruta);
    const escrita = armar(e.mercado, { valor: e.valor, fecha: e.fecha, fuente: 'manual', origen: 'manual' }, e.ahoraMs);
    guardar(tx, escrita, actual, e.por, opciones.base);
    return escrita;
  });
}

function armar(
  mercado: Mercado,
  n: { valor: number; fecha: string; fuente: FuenteCotizacion; origen: OrigenCarga },
  ahoraMs: number,
): CotizacionGuardada {
  return {
    cotizacionId: idCotizacion(mercado, n.fecha, ahoraMs), mercado, par: PAR_DE[mercado],
    valor: n.valor, fecha: n.fecha, fuente: n.fuente, origen: n.origen, actualizadoEn: new Date(ahoraMs).toISOString(),
  };
}

function guardar(tx: TransaccionCotizaciones, c: CotizacionGuardada, actual: Documento | null, por: string, base?: string): void {
  tx.establecer(rutaCotizacion(c.mercado, base), { ...c });
  tx.crear(rutaHistorial(c.mercado, c.cotizacionId, base), {
    ...c, por,
    antes: actual ? { valor: actual['valor'] ?? null, fecha: actual['fecha'] ?? null, fuente: actual['fuente'] ?? null } : null,
  });
}

/**
 * Lee la cotización que rige y le pone el estado. Lanza `SinCotizacionUtilizable`
 * si falta, está mal formada, es de una fecha demasiado futura o tiene más de
 * `diasLimite` días.
 */
export async function leerCotizacion(
  almacen: AlmacenCotizaciones,
  mercado: Mercado,
  ahoraMs: number,
  opciones: OpcionesAlmacen & { readonly config?: Partial<ConfigCotizacion> } = {},
): Promise<CopiaCotizacion> {
  const cfg = { ...CONFIG_POR_DEFECTO, ...opciones.config };
  const d = await almacen.leer(rutaCotizacion(mercado, opciones.base));
  if (!d) throw new SinCotizacionUtilizable(mercado, 'no hay cotización cargada');
  const { valor, fecha, fuente, cotizacionId } = d;
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) throw new SinCotizacionUtilizable(mercado, 'valor ausente o inválido');
  if (!esFechaIso(fecha)) throw new SinCotizacionUtilizable(mercado, 'fecha ausente o mal formada');
  if (typeof cotizacionId !== 'string' || cotizacionId === '') throw new SinCotizacionUtilizable(mercado, 'cotizacionId ausente');
  if (fuente !== 'BCB' && fuente !== 'BNA' && fuente !== 'BCRA' && fuente !== 'manual') throw new SinCotizacionUtilizable(mercado, 'fuente ausente o desconocida');
  const edad = diasEntre(fecha, hoyEn(mercado, ahoraMs));
  if (edad < -cfg.diasFuturoMax) throw new SinCotizacionUtilizable(mercado, 'fecha futura');
  if (edad > cfg.diasLimite) throw new SinCotizacionUtilizable(mercado, `la cotización tiene más de ${cfg.diasLimite} días (${fecha})`);
  return { cotizacionId, par: PAR_DE[mercado], valor, fecha, fuente, estado: edad <= cfg.diasVigente ? 'vigente' : 'ultimo_verificado' };
}

