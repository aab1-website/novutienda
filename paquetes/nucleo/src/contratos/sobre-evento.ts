import type { IdModulo, TipoEvento } from '../registro/tipos.js';
import type { Resultado } from './claim.js';

/** Sobre común de todos los eventos de la bandeja. */
export interface SobreEvento<D = unknown> {
  readonly id: string;
  readonly tipo: TipoEvento;
  readonly version: 1;
  readonly tenantId: string;
  readonly origen: IdModulo;
  /** Instante ISO 8601 en UTC. */
  readonly ocurridoEn: string;
  readonly claveIdempotencia: string;
  readonly datos: D;
}

const CAMPOS_TEXTO = ['id', 'tipo', 'tenantId', 'origen', 'ocurridoEn', 'claveIdempotencia'] as const;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** Valida el sobre; el contenido de `datos` lo valida el contrato de cada evento. */
export function validarSobre(x: unknown): Resultado<SobreEvento> {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return { ok: false, error: 'El sobre debe ser un objeto' };
  const o = x as Record<string, unknown>;
  for (const c of CAMPOS_TEXTO) {
    const v = o[c];
    if (typeof v !== 'string' || v === '') return { ok: false, error: `Campo ${c} requerido` };
  }
  if (o['version'] !== 1) return { ok: false, error: 'version debe ser 1' };
  if (!ISO_UTC.test(o['ocurridoEn'] as string) || Number.isNaN(Date.parse(o['ocurridoEn'] as string))) {
    return { ok: false, error: 'ocurridoEn debe ser ISO 8601 UTC' };
  }
  if (!('datos' in o) || o['datos'] === undefined) return { ok: false, error: 'Campo datos requerido' };
  return { ok: true, valor: x as SobreEvento };
}
