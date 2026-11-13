/**
 * Decisión pura: ¿se escribe lo leído? Nunca hacia atrás, nunca sobre una
 * carga manual igual o más nueva, nunca un salto grande sin una persona.
 * No lee ni escribe nada: recibe el documento actual y devuelve qué hacer.
 *
 * Reglas de la escritura automática:
 * - Una sola escritura por fecha: la misma fecha solo se reescribe si la
 *   fuente nueva tiene MAYOR prioridad (manual > BCB/BNA > A 3500 del BCRA).
 *   Una fuente de menor prioridad nunca reemplaza a la principal ya escrita.
 * - El tope de salto se mide contra un ANCLA (la última cotización de una
 *   fecha anterior), no contra la última escritura: así varias corridas del
 *   mismo día no encadenan saltos bajo el tope.
 * - Con control cruzado, un desvío mayor al máximo rechaza (lo resuelve una persona).
 * - Una fecha futura (tabla del día siguiente del BCB) queda diferida salvo
 *   que `futuroVigente` sea true.
 */
import type { ConfiguracionComercial } from '../tenant/mercados.js';
import { diasEntre, hoyEn } from './fechas.js';
import { esFechaIso } from './texto.js';
import {
  CONFIG_POR_DEFECTO,
  type Ancla, type ConfigCotizacion, type FuenteCotizacion, type IdMercado, type Lectura, type OrigenCarga,
} from './tipos.js';

export interface Aviso {
  readonly codigo: 'desvio_control' | 'respaldo_bcra' | 'actual_ilegible' | 'control_invalido';
  readonly detalle: string;
}

/** Lo que se escribiría: valor, fecha y fuente (el id y la hora los pone el escritor). */
export interface Nuevo {
  readonly valor: number;
  readonly fecha: string;
  readonly fuente: FuenteCotizacion;
  readonly origen: OrigenCarga;
  /** Ancla del tope de salto que queda guardada junto al valor. */
  readonly ancla: Ancla | null;
}

export type Decision =
  | { readonly accion: 'escribir'; readonly nuevo: Nuevo; readonly avisos: readonly Aviso[] }
  | {
    readonly accion: 'igual' | 'anterior' | 'manual_vigente' | 'rechazar' | 'ya_escrita' | 'diferida';
    readonly motivo: string;
    readonly avisos: readonly Aviso[];
  };

export interface EntradaDecision {
  readonly mercado: IdMercado;
  /** Declaración comercial del tenant (zona horaria del mercado); omitida = la del tenant de tres monedas (LEGADO). */
  readonly comercial?: ConfiguracionComercial;
  /** Documento guardado hoy (cualquier cosa; se valida). */
  readonly actual: unknown;
  /** Fuente principal (BCB en BO, BNA en AR); null si falló. */
  readonly principal: Lectura | null;
  /** Control cruzado y respaldo (BCRA A 3500 en AR); null si falló o no aplica. */
  readonly control: Lectura | null;
  readonly ahoraMs: number;
  readonly config?: Partial<ConfigCotizacion>;
}

interface Previo { valor: number; fecha: string; origen: OrigenCarga; fuente: FuenteCotizacion | null; ancla: Ancla | null }

/** Prioridad de la fuente dentro de una misma fecha. */
const PRIORIDAD: Readonly<Record<FuenteCotizacion, number>> = { manual: 3, BCB: 2, BNA: 2, BCRA: 1 };
const prioridadDe = (f: FuenteCotizacion | null): number => (f === null ? 0 : PRIORIDAD[f]);

function anclaDe(x: unknown): Ancla | null {
  if (typeof x !== 'object' || x === null) return null;
  const a = x as Record<string, unknown>;
  const valor = a['valor'];
  return typeof valor === 'number' && Number.isFinite(valor) && valor > 0 && esFechaIso(a['fecha']) ? { valor, fecha: a['fecha'] } : null;
}

/**
 * Ancla que corresponde guardar al escribir `fecha` sobre `previo`: si `previo` es de una fecha
 * ANTERIOR, él mismo; si es de la misma fecha, hereda su ancla (la de la última fecha anterior).
 */
export function anclaParaEscribir(previo: { valor: number; fecha: string; ancla?: unknown } | null, fecha: string): Ancla | null {
  if (!previo) return null;
  if (previo.fecha < fecha) return { valor: previo.valor, fecha: previo.fecha };
  return anclaDe(previo.ancla);
}

function previoDe(actual: unknown): Previo | null {
  if (typeof actual !== 'object' || actual === null) return null;
  const a = actual as Record<string, unknown>;
  const valor = a['valor'];
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0 || !esFechaIso(a['fecha'])) return null;
  const f = a['fuente'];
  const fuente = f === 'BCB' || f === 'BNA' || f === 'BCRA' || f === 'manual' ? f : null;
  return { valor, fecha: a['fecha'], origen: a['origen'] === 'manual' ? 'manual' : 'automatico', fuente, ancla: anclaDe(a['ancla']) };
}

const lecturaValida = (l: Lectura): boolean => Number.isFinite(l.valor) && l.valor > 0 && esFechaIso(l.fecha);

export function decidirCotizacion(e: EntradaDecision): Decision {
  const cfg = { ...CONFIG_POR_DEFECTO, ...e.config };
  const avisos: Aviso[] = [];
  const rechazo = (motivo: string): Decision => ({ accion: 'rechazar', motivo, avisos });

  const previo = previoDe(e.actual);
  if (e.actual !== null && e.actual !== undefined && previo === null) {
    avisos.push({ codigo: 'actual_ilegible', detalle: 'el documento guardado está mal formado; se trata como ausente' });
  }

  let control = e.control;
  if (control && !lecturaValida(control)) {
    avisos.push({ codigo: 'control_invalido', detalle: 'el control cruzado no es una lectura válida; se ignora' });
    control = null;
  }
  if (e.principal && !lecturaValida(e.principal)) return rechazo('la lectura principal no es válida');

  // Fuente: la principal; si falló, el control sirve de respaldo (con aviso).
  let elegida: Lectura | null = e.principal;
  if (!elegida && control) {
    elegida = control;
    avisos.push({ codigo: 'respaldo_bcra', detalle: 'la fuente principal no respondió; se usa la Comunicación A 3500 del BCRA' });
  }
  if (!elegida) return rechazo('sin lectura de ninguna fuente; se mantiene el último valor verificado');

  if (elegida === e.principal && control) {
    const desvio = Math.abs(elegida.valor - control.valor) / control.valor;
    if (desvio > cfg.desvioMaximo) {
      const detalle = `${elegida.fuente} ${elegida.valor} se aleja ${(desvio * 100).toFixed(2)} % de ${control.fuente} ${control.valor} (umbral ${cfg.desvioMaximo * 100} %)`;
      avisos.push({ codigo: 'desvio_control', detalle });
      return rechazo(`desvío con el control cruzado: ${detalle}; lo resuelve una persona`);
    }
  }

  const hoy = hoyEn(e.mercado, e.ahoraMs, e.comercial);
  const adelanto = diasEntre(hoy, elegida.fecha);
  if (adelanto > cfg.diasFuturoMax) return rechazo(`la fecha ${elegida.fecha} es posterior a lo admitido (hoy ${hoy})`);
  if (adelanto > 0 && !cfg.futuroVigente) {
    return { accion: 'diferida', motivo: `la fecha ${elegida.fecha} es posterior a hoy (${hoy}); se escribe cuando llegue`, avisos };
  }

  if (previo) {
    if (previo.origen === 'manual' && elegida.fecha <= previo.fecha) {
      return { accion: 'manual_vigente', motivo: 'hay una carga manual igual o más nueva', avisos };
    }
    if (elegida.fecha < previo.fecha) return { accion: 'anterior', motivo: 'lo guardado es más nuevo', avisos };
    if (elegida.fecha === previo.fecha) {
      if (elegida.valor === previo.valor) return { accion: 'igual', motivo: 'sin cambios', avisos };
      if (prioridadDe(elegida.fuente) <= prioridadDe(previo.fuente)) {
        return { accion: 'ya_escrita', motivo: `ya hay una escritura automática de ${previo.fecha} (${previo.fuente ?? 'sin fuente'}); no se reemplaza con ${elegida.fuente}`, avisos };
      }
    }
    // Ancla: la última cotización de una fecha anterior; si la guardada es de esta misma fecha, su ancla.
    const referencia: Ancla = previo.fecha < elegida.fecha ? { valor: previo.valor, fecha: previo.fecha } : (previo.ancla ?? { valor: previo.valor, fecha: previo.fecha });
    if (Math.abs(elegida.valor - referencia.valor) / referencia.valor > cfg.saltoMaximo) {
      return rechazo(`salto de ${referencia.valor} (${referencia.fecha}) a ${elegida.valor}: más del ${cfg.saltoMaximo * 100} %, lo carga una persona`);
    }
  }
  return {
    accion: 'escribir',
    nuevo: { valor: elegida.valor, fecha: elegida.fecha, fuente: elegida.fuente, origen: 'automatico', ancla: anclaParaEscribir(previo, elegida.fecha) },
    avisos,
  };
}
