import type { LogoNegocio } from '../api/tipos.js';

/** Base pública del almacén de medios, de la variable de compilación; vacía si no está definida. */
export const baseDeMedios = (): string => String(import.meta.env['VITE_MEDIOS_BASE_URL'] ?? '').trim();

const SEGMENTO = /^[A-Za-z0-9._-]+$/;

/** Lista blanca: segmentos `[A-Za-z0-9._-]+` separados por `/`, sin `.` ni `..`, sin `%`, espacios ni barra inicial o final. */
export function rutaPublicaSegura(ruta: string): boolean {
  if (ruta === '') return false;
  return ruta.split('/').every((s) => SEGMENTO.test(s) && s !== '.' && s !== '..' && !s.includes('..'));
}

/**
 * URL de vista del logo subido: `base/ruta` de la versión WebP (o PNG si no hay) de mayor lado, o `null` si no hay base,
 * no hay versión o la ruta no es segura (nunca se pinta una ruta que no pase la lista blanca).
 */
export function urlDelLogo(base: string | undefined, logo: LogoNegocio): string | null {
  const b = (base ?? '').trim().replace(/\/+$/, '');
  if (b === '') return null;
  const mayor = (formato: 'webp' | 'png'): LogoNegocio['versiones'][number] | undefined =>
    [...logo.versiones].filter((v) => v.formato === formato).sort((a, c) => c.lado - a.lado)[0];
  const v = mayor('webp') ?? mayor('png');
  if (v === undefined || !rutaPublicaSegura(v.ruta)) return null;
  return `${b}/${v.ruta}`;
}
