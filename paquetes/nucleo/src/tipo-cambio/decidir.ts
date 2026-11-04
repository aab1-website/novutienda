/**
 * Decisión pura: ¿se escribe lo leído? Nunca hacia atrás, nunca sobre una
 * carga manual igual o más nueva, nunca un salto grande sin una persona.
 * No lee ni escribe nada: recibe el documento actual y devuelve qué hacer.
 */
import { diasEntre, hoyEn } from './fechas.js';
import { esFechaIso } from './texto.js';
import {
  CONFIG_POR_DEFECTO,
  type ConfigCotizacion, type FuenteCotizacion, type Lectura, type Mercado, type OrigenCarga,
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
}

export type Decision =
  | { readonly accion: 'escribir'; readonly nuevo: Nuevo; readonly avisos: readonly Aviso[] }
  | { readonly accion: 'igual' | 'anterior' | 'manual_vigente' | 'rechazar'; readonly motivo: string; readonly avisos: readonly Aviso[] };

export interface EntradaDecision {
  readonly mercado: Mercado;
  /** Documento guardado hoy (cualquier cosa; se valida). */
  readonly actual: unknown;
  /** Fuente principal (BCB en BO, BNA en AR); null si falló. */
  readonly principal: Lectura | null;
  /** Control cruzado y respaldo (BCRA A 3500 en AR); null si falló o no aplica. */
  readonly control: Lectura | null;
  readonly ahoraMs: number;
  readonly config?: Partial<ConfigCotizacion>;
}

interface Previo { valor: number; fecha: string; origen: OrigenCarga }

function previoDe(actual: unknown): Previo | null {
  if (typeof actual !== 'object' || actual === null) return null;
  const a = actual as Record<string, unknown>;
  const valor = a['valor'];
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0 || !esFechaIso(a['fecha'])) return null;
  return { valor, fecha: a['fecha'], origen: a['origen'] === 'manual' ? 'manual' : 'automatico' };
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
      avisos.push({
        codigo: 'desvio_control',
        detalle: `${elegida.fuente} ${elegida.valor} se aleja ${(desvio * 100).toFixed(2)} % de ${control.fuente} ${control.valor} (umbral ${cfg.desvioMaximo * 100} %)`,
      });
    }
  }

  const hoy = hoyEn(e.mercado, e.ahoraMs);
  if (diasEntre(hoy, elegida.fecha) > cfg.diasFuturoMax) return rechazo(`la fecha ${elegida.fecha} es posterior a lo admitido (hoy ${hoy})`);

  if (previo) {
    if (previo.origen === 'manual' && elegida.fecha <= previo.fecha) {
      return { accion: 'manual_vigente', motivo: 'hay una carga manual igual o más nueva', avisos };
    }
    if (elegida.fecha < previo.fecha) return { accion: 'anterior', motivo: 'lo guardado es más nuevo', avisos };
    if (elegida.fecha === previo.fecha && elegida.valor === previo.valor && previo.origen === 'automatico') {
      return { accion: 'igual', motivo: 'sin cambios', avisos };
    }
    if (Math.abs(elegida.valor - previo.valor) / previo.valor > cfg.saltoMaximo) {
      return rechazo(`salto de ${previo.valor} a ${elegida.valor}: más del ${cfg.saltoMaximo * 100} %, lo carga una persona`);
    }
  }
  return { accion: 'escribir', nuevo: { valor: elegida.valor, fecha: elegida.fecha, fuente: elegida.fuente, origen: 'automatico' }, avisos };
}

