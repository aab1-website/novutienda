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
import { CONFIG_POR_DEFECTO, type CotizacionGuardada, type ConfigCotizacion, type IdMercado } from './tipos.js';

/** Falta la confirmación expresa de una operación que la exige (volver al del banco central). */
export class ConfirmacionRequerida extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ConfirmacionRequerida';
  }
}

/**
 * Banda absoluta de cordura por par (VENTA/BASE): fuera de ella el valor se rechaza aunque venga confirmado,
 * para que un error de tipeo no frene las ventas. Un par sin entrada usa `BANDA_POR_DEFECTO`.
 */
export const BANDAS_POR_PAR: Readonly<Record<string, readonly [number, number]>> = { 'BOB/USD': [1, 100], 'ARS/USD': [10, 100_000] };
export const BANDA_POR_DEFECTO: readonly [number, number] = [0.0001, 10_000_000];

/** El valor cae fuera de la banda de cordura del par. */
export class ValorFueraDeBanda extends RangeError {
  constructor(readonly par: string, readonly valor: number, readonly minimo: number, readonly maximo: number) {
    super(`el valor ${valor} está fuera del rango admitido para ${par} (${minimo} a ${maximo})`);
    this.name = 'ValorFueraDeBanda';
  }
}

const valido = (d: Documento | null): d is Documento & { valor: number; fecha: string } =>
  d !== null && typeof d['valor'] === 'number' && Number.isFinite(d['valor']) && d['valor'] > 0 && esFechaIso(d['fecha']);

/**
 * Fija el tipo de cambio manual del mercado. Solo administrador con contraseña o propietario.
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
  if (!Number.isFinite(e.valor) || e.valor <= 0) throw new RangeError('el valor debe ser un número positivo');
  if (e.actor.uid.trim() === '') throw new RangeError('hay que indicar quién carga');
  const par = tieneTipoCambio(opciones.comercial, e.mercado) ? parDe(opciones.comercial, e.mercado) : null;
  if (par === null) throw new RangeError(`el mercado ${e.mercado} no está declarado o no tiene tipo de cambio`);
  const [minimo, maximo] = BANDAS_POR_PAR[par] ?? BANDA_POR_DEFECTO;
  if (e.valor < minimo || e.valor > maximo) throw new ValorFueraDeBanda(par, e.valor, minimo, maximo);
  const fecha = hoyEn(e.mercado, e.ahoraMs, opciones.comercial);
  const rutaM = rutaCotizacionManual(opciones.tenantId, e.mercado);
  const rutaR = rutaCotizacion(opciones.tenantId, e.mercado);
  return almacen.transaccion(async (tx) => {
    const manual = await tx.leer(rutaM);
    const base = manual !== null && manual['activo'] !== false && valido(manual) ? manual : await tx.leer(rutaR);
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
  if (e.actor.uid.trim() === '') throw new RangeError('hay que indicar quién quita');
  if (!tieneTipoCambio(opciones.comercial, e.mercado)) throw new RangeError(`el mercado ${e.mercado} no está declarado o no tiene tipo de cambio`);
  const rutaM = rutaCotizacionManual(opciones.tenantId, e.mercado);
  return almacen.transaccion(async (tx) => {
    const manual = await tx.leer(rutaM);
    if (manual === null || manual['activo'] === false || !valido(manual)) throw new RangeError('no hay un tipo de cambio manual vigente que quitar');
    const ahora = new Date(e.ahoraMs).toISOString();
    tx.establecer(rutaM, { ...manual, activo: false });
    tx.crear(`${rutaM}/historial/${e.mercado}-quitar-${e.ahoraMs}`, {
      accion: 'quitar', mercado: e.mercado, por: e.actor.uid, actualizadoEn: ahora,
      antes: { valor: manual.valor, fecha: manual.fecha, fuente: manual['fuente'] ?? null },
    });
    return true as const;
  });
}
