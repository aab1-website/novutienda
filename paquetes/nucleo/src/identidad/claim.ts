import { LIMITE_BYTES_CLAIM, validarClaim, type ClaimPlataforma, type Resultado } from '../contratos/claim.js';
import type { Rol } from '../registro/tipos.js';

export { LIMITE_BYTES_CLAIM };

/** Construye el claim `{ pl: { t, p?, v } }` y lo valida (forma y < 1000 bytes). */
export function construirClaim(
  roles: { readonly [tenantId: string]: Rol },
  version: number,
  propietario = false,
): Resultado<ClaimPlataforma> {
  const pl = propietario ? { t: { ...roles }, p: true as const, v: version } : { t: { ...roles }, v: version };
  return validarClaim({ pl });
}

/** Tamaño en bytes (UTF-8) del JSON de los claims COMPLETOS de un usuario, que es lo que mide Firebase. */
export function bytesClaimCompleto(claims: Readonly<Record<string, unknown>>): number {
  let n = 0;
  for (const c of JSON.stringify(claims)) {
    const p = c.codePointAt(0) ?? 0;
    n += p < 0x80 ? 1 : p < 0x800 ? 2 : p < 0x10000 ? 3 : 4;
  }
  return n;
}

/**
 * Lee el claim de un token decodificado (o de `customClaims`). Solo se
 * considera la clave `pl`; el resto del token no cuenta para el tamaño.
 */
export function leerClaim(claims: unknown): Resultado<ClaimPlataforma> {
  if (typeof claims !== 'object' || claims === null || !('pl' in claims)) {
    return { ok: false, error: 'Sin claim pl' };
  }
  return validarClaim({ pl: (claims as { pl: unknown }).pl });
}

/** Proveedor de inicio de sesión del token decodificado (`firebase.sign_in_provider`). */
export function proveedorDe(claims: unknown): string {
  if (typeof claims !== 'object' || claims === null) return '';
  const fb = (claims as { firebase?: unknown }).firebase;
  if (typeof fb !== 'object' || fb === null) return '';
  const p = (fb as { sign_in_provider?: unknown }).sign_in_provider;
  return typeof p === 'string' ? p : '';
}

/**
 * Rol del usuario en el tenant, o `''` si no hay: sin claim, claim inválido,
 * tenant ausente del claim o sesión anónima.
 */
export function rolEn(claims: unknown, tenantId: string): Rol | '' {
  if (proveedorDe(claims) === 'anonymous') return '';
  const c = leerClaim(claims);
  if (!c.ok || !Object.hasOwn(c.valor.pl.t, tenantId)) return '';
  return c.valor.pl.t[tenantId] ?? '';
}

/** Acceso de plataforma (propietario): claim `p` y sesión con Google. */
export function esPropietario(claims: unknown): boolean {
  if (proveedorDe(claims) !== 'google.com') return false;
  const c = leerClaim(claims);
  return c.ok && c.valor.pl.p === true;
}
