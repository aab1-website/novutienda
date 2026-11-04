import type { Rol } from '@novutienda/nucleo';

const ROLES: readonly string[] = ['caj', 'sup', 'adm'];

/**
 * Lee el claim `pl` del token (`pl.t`: rol por tenant). Devuelve el tenant y el rol, o `null` si no hay acceso.
 * Si hubiera varios tenants se elige el primero en orden alfabético (el panel atiende a un negocio por vez).
 */
export function leerClaimPanel(claims: unknown): { tenantId: string; rol: Rol } | null {
  if (typeof claims !== 'object' || claims === null) return null;
  const pl = (claims as Record<string, unknown>)['pl'];
  if (typeof pl !== 'object' || pl === null) return null;
  const t = (pl as Record<string, unknown>)['t'];
  if (typeof t !== 'object' || t === null || Array.isArray(t)) return null;
  const validos = Object.entries(t as Record<string, unknown>)
    .filter(([id, rol]) => id !== '' && typeof rol === 'string' && ROLES.includes(rol))
    .sort(([a], [b]) => a.localeCompare(b));
  const primero = validos[0];
  return primero === undefined ? null : { tenantId: primero[0], rol: primero[1] as Rol };
}
