import type { Rol } from '../registro/tipos.js';

/**
 * Claim de Firebase Auth. Claves cortas para no pasar de 1000 bytes.
 * `t`: rol por tenant; `p`: acceso de plataforma; `v`: versión del claim.
 */
export interface ClaimPlataforma {
  readonly pl: {
    readonly t: { readonly [tenantId: string]: Rol };
    readonly p?: true;
    readonly v: number;
  };
}

export type Resultado<T> = { readonly ok: true; readonly valor: T } | { readonly ok: false; readonly error: string };

export const LIMITE_BYTES_CLAIM = 1000;
const ROLES: readonly string[] = ['caj', 'sup', 'adm', 'dir'];

const esObjeto = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/** Tamaño en bytes de un texto en UTF-8 (sin depender de TextEncoder). */
function bytesUtf8(texto: string): number {
  let n = 0;
  for (const c of texto) {
    const p = c.codePointAt(0) ?? 0;
    n += p < 0x80 ? 1 : p < 0x800 ? 2 : p < 0x10000 ? 3 : 4;
  }
  return n;
}

/** Valida la forma del claim y su tamaño serializado (< 1000 bytes). */
export function validarClaim(x: unknown): Resultado<ClaimPlataforma> {
  if (!esObjeto(x) || !esObjeto(x['pl'])) return { ok: false, error: 'Falta pl' };
  const pl = x['pl'];
  const t = pl['t'];
  if (!esObjeto(t)) return { ok: false, error: 'pl.t debe ser un objeto' };
  for (const [tenant, rol] of Object.entries(t)) {
    if (tenant === '') return { ok: false, error: 'tenantId vacío' };
    if (typeof rol !== 'string' || !ROLES.includes(rol)) {
      return { ok: false, error: `Rol inválido para ${tenant}` };
    }
  }
  if (pl['p'] !== undefined && pl['p'] !== true) return { ok: false, error: 'pl.p solo admite true' };
  const v = pl['v'];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    return { ok: false, error: 'pl.v debe ser un entero positivo' };
  }
  for (const k of Object.keys(pl)) {
    if (k !== 't' && k !== 'p' && k !== 'v') return { ok: false, error: `Clave desconocida pl.${k}` };
  }
  if (bytesUtf8(JSON.stringify(x)) >= LIMITE_BYTES_CLAIM) {
    return { ok: false, error: 'Claim de 1000 bytes o más' };
  }
  return { ok: true, valor: x as unknown as ClaimPlataforma };
}
