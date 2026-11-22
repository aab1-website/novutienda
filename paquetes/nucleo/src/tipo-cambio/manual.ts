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
  const fecha = hoyEn(e.mercado, e.ahoraMs, opciones.comercial);
  const rutaM = rutaCotizacionManual(opciones.tenantId, e.mercado);
  const rutaR = rutaCotizacion(opciones.tenantId, e.mercado);
  return almacen.transaccion(async (tx) => {
    const manual = await tx.leer(rutaM);
    const base = manual !== null && manual['activo'] !== false && valido(manual) ? manual : await tx.leer(rutaR);
    const previo = valido(base) ? base.valor : null;
    if (previo !== null && Math.abs(e.valor - previo) / previo > cfg.saltoMaximo && e.confirmarSalto !== true) {
      throw new SaltoSinConfirmar(previo, e.valor, cfg.saltoMaximo);
    }
    const escrita: CotizacionGuardada = {
      cotizacionId: idCotizacion(e.mercado, fecha, e.ahoraMs), mercado: e.mercado, par, valor: e.valor, fecha,
      fuente: 'manual', origen: 'manual', actualizadoEn: new Date(e.ahoraMs).toISOString(), ancla: null,
    };
    tx.establecer(rutaM, { ...escrita, activo: true, por: e.actor.uid });
    tx.crear(`${rutaM}/historial/${escrita.cotizacionId}`, {
      ...escrita, accion: 'fijar', por: e.actor.uid,
      antes: valido(base) ? { valor: base.valor, fecha: base.fecha, fuente: base['fuente'] ?? null } : null,
    });
    return escrita;
  });
}

/**
 * Vuelve al tipo de cambio del banco central: deja inactivo el manual vigente (conserva el documento)
 * y registra la quita en el historial. Solo administrador con contraseña y con `confirmar: true`.
 * Lanza si no hay un manual activo.
 */
export async function quitarCotizacionManualDe(
  almacen: AlmacenCotizaciones,
  e: { mercado: IdMercado; actor: ActorCarga; ahoraMs: number; confirmar?: boolean },
  opciones: OpcionesAlmacenDe,
): Promise<true> {
  if (e.actor.rol !== 'adm' || e.actor.proveedor !== 'password') throw new CargaNoAutorizada();
  if (e.confirmar !== true) throw new ConfirmacionRequerida('volver al tipo de cambio del banco central exige confirmación expresa');
  if (e.actor.uid.trim() === '') throw new RangeError('hay que indicar quién quita');
  if (!tieneTipoCambio(opciones.comercial, e.mercado)) throw new RangeError(`el mercado ${e.mercado} no está declarado o no tiene tipo de cambio`);
  const rutaM = rutaCotizacionManual(opciones.tenantId, e.mercado);
  return almacen.transaccion(async (tx) => {
    const manual = await tx.leer(rutaM);
    if (manual === null || manual['activo'] === false || !valido(manual)) throw new RangeError('no hay un tipo de cambio manual vigente que quitar');
    const ahora = new Date(e.ahoraMs).toISOString();
    tx.establecer(rutaM, { ...manual, activo: false, quitadoPor: e.actor.uid, quitadoEn: ahora });
    tx.crear(`${rutaM}/historial/${e.mercado}-quitar-${e.ahoraMs}`, {
      accion: 'quitar', mercado: e.mercado, por: e.actor.uid, actualizadoEn: ahora,
      antes: { valor: manual.valor, fecha: manual.fecha, fuente: manual['fuente'] ?? null },
    });
    return true as const;
  });
}
