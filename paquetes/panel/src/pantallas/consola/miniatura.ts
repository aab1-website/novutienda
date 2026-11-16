import type { Medio, VersionMedio } from '../../api/tipos.js';

/** Base pública del almacén de medios, de la variable de compilación; vacía si no está definida. */
export const baseMedios = (): string => String(import.meta.env['VITE_MEDIOS_BASE_URL'] ?? '').trim();

/** Segmento permitido de una ruta pública: letras, dígitos, punto, guion y guion bajo (lo que genera el servidor). */
const SEGMENTO = /^[A-Za-z0-9._-]+$/;

/** Lista blanca: segmentos `[A-Za-z0-9._-]+` separados por `/`, sin `.` ni `..`, sin `%`, espacios ni barra inicial o final. */
export function rutaSegura(ruta: string): boolean {
  if (ruta === '') return false;
  return ruta.split('/').every((s) => SEGMENTO.test(s) && s !== '.' && s !== '..' && !s.includes('..'));
}

const masChica = (vs: readonly VersionMedio[]): VersionMedio | undefined => [...vs].sort((a, b) => a.lado - b.lado || a.bytes - b.bytes)[0];

/** Versión de vista previa: la WebP más chica (imagen) o el póster más chico (video, preferido en WebP). */
export function versionMiniatura(medio: Medio): VersionMedio | undefined {
  const vs = medio.versiones ?? [];
  if (medio.tipo === 'video') {
    const posters = vs.filter((v) => v.clase === 'poster' && v.formato !== 'mp4');
    return masChica(posters.filter((v) => v.formato === 'webp')) ?? masChica(posters);
  }
  return masChica(vs.filter((v) => v.clase === 'imagen' && v.formato === 'webp'));
}

/** URL de la miniatura (`base/ruta`) o `null` si no hay base, no hay versión adecuada o la ruta no es segura. */
export function urlMiniatura(base: string | undefined, medio: Medio): string | null {
  const b = (base ?? '').trim().replace(/\/+$/, '');
  if (b === '') return null;
  const v = versionMiniatura(medio);
  if (v === undefined || !rutaSegura(v.ruta)) return null;
  return `${b}/${v.ruta}`;
}
