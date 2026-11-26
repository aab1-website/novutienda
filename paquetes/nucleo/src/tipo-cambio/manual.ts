/**
 * Tipo de cambio MANUAL por mercado: `tenants/{t}/cotizaciones/manual-{M}` (valor vigente, sin vencimiento)
 * y `.../manual-{M}/historial/{id}` (inmutable; solo lo lee el servidor). La referencia automática
 * (`cotizaciones/{M}`) no se toca: la corrida automática y esta carga no se pisan.
 */
import { tieneTipoCambio, parDe } from '../tenant/mercados.js';
import { hoyEn } from './fechas.js';
import {
  CargaNoAutorizada, SaltoSinConfirmar, esAutorizado, idCotizacion, rutaCotizacion, rutaCotizacionManual,
  type ActorCarga, type OpcionesAlmacenDe, type AlmacenCotizaciones, type Documento,
} from './almacen.js';
import { esFechaIso } from './texto.js';
import { leerReferenciaDe } from './almacen.js';
import type { EsFeriado } from './fechas.js';
import { CONFIG_POR_DEFECTO, SinCotizacionUtilizable, type CopiaCotizacion, type CotizacionGuardada, type ConfigCotizacion, type IdMercado } from './tipos.js';

/** Falta la confirmación expresa de una operación que la exige (volver al del banco central). */
export class ConfirmacionRequerida extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ConfirmacionRequerida';
  }
}

/**
 * Banda absoluta de cordura por par (VENTA/BASE), de respaldo cuando no hay referencia del banco central utilizable;
 * fuera de ella el valor se rechaza aunque venga confirmado, para que un error de tipeo no frene las ventas. Un par sin entrada usa `BANDA_POR_DEFECTO`.
 */
export const BANDAS_POR_PAR: Readonly<Record<string, readonly [number, number]>> = { 'BOB/USD': [1, 100], 'ARS/USD': [10, 100_000] };
export const BANDA_POR_DEFECTO: readonly [number, number] = [0.0001, 10_000_000];

/** Banda relativa sobre la referencia del banco central: el manual se admite hasta ±50 % de ella (bordes incluidos). */
export const BANDA_RELATIVA = 0.5;

const TOLERANCIA = 1e-9;
/** Número con coma decimal y los decimales necesarios (sin ruido de punto flotante ni ceros de más): nunca redondea un valor hasta contradecir el rechazo. */
const formatear = (n: number): string => String(Number(n.toPrecision(10))).replace('.', ',');
const ETIQUETA_BANDA_RELATIVA = `±${formatear(BANDA_RELATIVA * 100)} % del banco central`;

/**
 * El valor cae fuera del rango admitido del par: ±50 % de la referencia del banco central, o la banda
 * absoluta si no hay referencia utilizable.
 */
export class ValorFueraDeBanda extends RangeError {
  /** Rango admitido ya formateado («5,915 a 17,745»). */
  readonly rango: string;
  /**
   * Rango con su origen, listo para mostrar: «5,915 a 17,745: ±50 % del banco central» con referencia,
   * «1 a 100» con la banda absoluta. Quien traduzca el error usa este campo y no escribe el texto a mano.
   */
  readonly descripcion: string;
  /** `referencia` es el valor del banco central que fijó el rango, o `null` si rigió la banda absoluta. */
  constructor(readonly par: string, readonly valor: number, readonly minimo: number, readonly maximo: number, readonly referencia: number | null = null) {
    const rango = `${formatear(minimo)} a ${formatear(maximo)}`;
    const descripcion = referencia === null ? rango : `${rango}: ${ETIQUETA_BANDA_RELATIVA}`;
    super(`el valor ${formatear(valor)} está fuera del rango admitido para ${par} (${descripcion})`);
    this.rango = rango;
    this.descripcion = descripcion;
    this.name = 'ValorFueraDeBanda';
  }
}

const valido = (d: Documento | null): d is Documento & { valor: number; fecha: string } =>
  d !== null && typeof d['valor'] === 'number' && Number.isFinite(d['valor']) && d['valor'] > 0 && esFechaIso(d['fecha']);

/**
 * Fija el tipo de cambio manual del mercado. Solo administrador con contraseña o propietario.
 * La referencia de la banda relativa es la automática guardada (no la manual) y se usa aunque su estado sea
 * `ultimo_verificado` (vieja pero no inválida); una referencia con `fuente: 'manual'` (caso heredado) se ignora.
 * La fecha la pone el servidor (`hoyEn`). El salto de más de `saltoMaximo` (5 %) contra el manual
 * anterior activo, o contra la referencia si no hay, exige `confirmarSalto: true`.
 * Deja una entrada de historial con `por` y `antes`.
 */
export async function fijarCotizacionManualDe(
  almacen: AlmacenCotizaciones,
  e: { mercado: IdMercado; valor: number; actor: ActorCarga; ahoraMs: number; confirmarSalto?: boolean; config?: Partial<ConfigCotizacion> },
  opciones: OpcionesAlmacenDe,
): Promise<CotizacionGuardada> {
  if (!esAutorizado(e.actor)) throw new CargaNoAutorizada();
  const cfg = { ...CONFIG_POR_DEFECTO, ...e.config };
  if (!Number.isFinite(e.valor) || e.valor <= 0) throw new TipoCambioInvalido('el valor debe ser un número positivo');
  if (e.actor.uid.trim() === '') throw new TipoCambioInvalido('hay que indicar quién carga');
  const par = tieneTipoCambio(opciones.comercial, e.mercado) ? parDe(opciones.comercial, e.mercado) : null;
  if (par === null) throw new TipoCambioInvalido(`el mercado ${e.mercado} no está declarado o no tiene tipo de cambio`);
  const fecha = hoyEn(e.mercado, e.ahoraMs, opciones.comercial);
  const rutaM = rutaCotizacionManual(opciones.tenantId, e.mercado);
  const rutaR = rutaCotizacion(opciones.tenantId, e.mercado);
  return almacen.transaccion(async (tx) => {
    const manual = await tx.leer(rutaM);
    const ref = await tx.leer(rutaR);
    // Banda relativa sobre la referencia del banco central (no el manual); sin referencia utilizable, la absoluta por par.
    const refValor = valido(ref) && ref['fuente'] !== 'manual' ? ref.valor : null;
    const [minimo, maximo] = refValor !== null
      ? [refValor * (1 - BANDA_RELATIVA), refValor * (1 + BANDA_RELATIVA)]
      : (BANDAS_POR_PAR[par] ?? BANDA_POR_DEFECTO);
    if (e.valor < minimo * (1 - TOLERANCIA) || e.valor > maximo * (1 + TOLERANCIA)) throw new ValorFueraDeBanda(par, e.valor, minimo, maximo, refValor);
    const base = manual !== null && manual['activo'] !== false && valido(manual) ? manual : ref;
    const previo = valido(base) ? base.valor : null;
    // Sin base de comparación no hay cómo medir el salto: se exige la confirmación expresa.
    if (e.confirmarSalto !== true && (previo === null || Math.abs(e.valor - previo) / previo > cfg.saltoMaximo)) {
      throw new SaltoSinConfirmar(previo ?? 0, e.valor, cfg.saltoMaximo);
    }
    const escrita: CotizacionGuardada = {
      cotizacionId: idCotizacion(e.mercado, fecha, e.ahoraMs), mercado: e.mercado, par, valor: e.valor, fecha,
      fuente: 'manual', origen: 'manual', actualizadoEn: new Date(e.ahoraMs).toISOString(), ancla: null,
    };
    tx.establecer(rutaM, { ...escrita, activo: true }); // sin uid: lo leen caj y sup; el uid va solo en el historial
    tx.crear(`${rutaM}/historial/${escrita.cotizacionId}`, {
      ...escrita, accion: 'fijar', por: e.actor.uid,
      antes: valido(base) ? { valor: base.valor, fecha: base.fecha, fuente: base['fuente'] ?? null } : null,
    });
    return escrita;
  });
}

/** Entrada inválida del tipo de cambio (valor, quién actúa, mercado no declarado). Sigue siendo un `RangeError`. */
export class TipoCambioInvalido extends RangeError {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'TipoCambioInvalido';
  }
}

/** No hay un tipo de cambio manual vigente que quitar. Sigue siendo un `RangeError`. */
export class SinManualActivo extends RangeError {
  constructor() {
    super('no hay un tipo de cambio manual vigente que quitar');
    this.name = 'SinManualActivo';
  }
}

/**
 * Vuelve al tipo de cambio del banco central: deja inactivo el manual vigente (conserva el documento)
 * y registra la quita en el historial. Mismo permiso que fijar (administrador con contraseña o propietario) y con `confirmar: true`.
 * Lanza si no hay un manual activo.
 */
export async function quitarCotizacionManualDe(
  almacen: AlmacenCotizaciones,
  e: { mercado: IdMercado; actor: ActorCarga; ahoraMs: number; confirmar?: boolean },
  opciones: OpcionesAlmacenDe,
): Promise<true> {
  if (!esAutorizado(e.actor)) throw new CargaNoAutorizada();
  if (e.confirmar !== true) throw new ConfirmacionRequerida('volver al tipo de cambio del banco central exige confirmación expresa');
  if (e.actor.uid.trim() === '') throw new TipoCambioInvalido('hay que indicar quién quita');
  if (!tieneTipoCambio(opciones.comercial, e.mercado)) throw new TipoCambioInvalido(`el mercado ${e.mercado} no está declarado o no tiene tipo de cambio`);
  const rutaM = rutaCotizacionManual(opciones.tenantId, e.mercado);
  return almacen.transaccion(async (tx) => {
    const manual = await tx.leer(rutaM);
    if (manual === null || manual['activo'] === false || !valido(manual)) throw new SinManualActivo();
    const ahora = new Date(e.ahoraMs).toISOString();
    tx.establecer(rutaM, { ...manual, activo: false });
    tx.crear(`${rutaM}/historial/${e.mercado}-quitar-${e.ahoraMs}`, {
      accion: 'quitar', mercado: e.mercado, por: e.actor.uid, actualizadoEn: ahora,
      antes: { valor: manual.valor, fecha: manual.fecha, fuente: manual['fuente'] ?? null },
    });
    return true as const;
  });
}

/** Una entrada del historial del manual (quién, qué y cuándo). */
export interface EntradaHistorialManual {
  readonly id: string;
  readonly accion: 'fijar' | 'quitar';
  readonly por: string;
  readonly valor: number | null;
  readonly fecha: string | null;
  readonly actualizadoEn: string;
  readonly antes: { readonly valor: unknown; readonly fecha: unknown; readonly fuente: unknown } | null;
}

/** Lo que muestra la pantalla de un mercado: la referencia automática, el manual vigente (si lo hay) y el historial reciente. */
export interface VistaTipoCambio {
  readonly mercado: IdMercado;
  readonly par: string;
  /** La cotización automática (BCB/BNA) con su estado, o el motivo por el que no hay una utilizable. */
  readonly referencia: CopiaCotizacion<string> | { readonly motivo: string };
  /** El manual vigente; `por` sale de su última entrada de historial (el documento no lleva uid). */
  readonly manual: { readonly cotizacionId: string; readonly valor: number; readonly fecha: string; readonly actualizadoEn: string; readonly por: string | null } | null;
  readonly historial: readonly EntradaHistorialManual[];
}

/**
 * Vista de un mercado para el panel. `limite` (por defecto 20) acota el historial; si el almacén no
 * implementa `listarRecientes`, el historial va vacío y `manual.por` es `null`.
 */
export async function leerTipoCambioDe(
  almacen: AlmacenCotizaciones,
  mercado: IdMercado,
  ahoraMs: number,
  opciones: OpcionesAlmacenDe & { readonly config?: Partial<ConfigCotizacion>; readonly esFeriado?: EsFeriado; readonly limite?: number },
): Promise<VistaTipoCambio> {
  const par = tieneTipoCambio(opciones.comercial, mercado) ? parDe(opciones.comercial, mercado) : null;
  if (par === null) throw new TipoCambioInvalido(`el mercado ${mercado} no está declarado o no tiene tipo de cambio`);
  let referencia: VistaTipoCambio['referencia'];
  try {
    referencia = await leerReferenciaDe(almacen, mercado, ahoraMs, opciones);
  } catch (e) {
    if (!(e instanceof SinCotizacionUtilizable)) throw e;
    referencia = { motivo: e.motivo };
  }
  const rutaM = rutaCotizacionManual(opciones.tenantId, mercado);
  const d = await almacen.leer(rutaM);
  const docs = almacen.listarRecientes ? await almacen.listarRecientes(`${rutaM}/historial`, opciones.limite ?? 20) : [];
  const historial: EntradaHistorialManual[] = docs.map((h) => ({
    id: typeof h['cotizacionId'] === 'string' ? h['cotizacionId'] : '',
    accion: h['accion'] === 'quitar' ? 'quitar' : 'fijar',
    por: typeof h['por'] === 'string' ? h['por'] : '',
    valor: typeof h['valor'] === 'number' ? h['valor'] : null,
    fecha: typeof h['fecha'] === 'string' ? h['fecha'] : null,
    actualizadoEn: typeof h['actualizadoEn'] === 'string' ? h['actualizadoEn'] : '',
    antes: h['antes'] !== null && typeof h['antes'] === 'object' ? (h['antes'] as EntradaHistorialManual['antes']) : null,
  }));
  const activo = d !== null && d['activo'] !== false && valido(d) && typeof d['cotizacionId'] === 'string' && d['cotizacionId'] !== '';
  const manual = activo
    ? {
      cotizacionId: d['cotizacionId'] as string, valor: d.valor, fecha: d.fecha,
      actualizadoEn: typeof d['actualizadoEn'] === 'string' ? d['actualizadoEn'] : '',
      por: historial.find((h) => h.accion === 'fijar' && h.id === d['cotizacionId'])?.por ?? null,
    }
    : null;
  return { mercado, par, referencia, manual, historial };
}
