import type { Medio, VersionMedio } from '../../api/tipos.js';

/** Base pública del almacén de medios, de la variable de compilación; vacía si no está definida. */
export const baseMedios = (): string => String(import.meta.env['VITE_MEDIOS_BASE_URL'] ?? '').trim();

/** Una ruta pública válida es relativa, sin esquema, sin `..`, sin `//` y sin caracteres de control o de escape. */
export function rutaSegura(ruta: string): boolean {
  if (ruta === '' || ruta.startsWith('/')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(ruta)) return false;
  if (ruta.includes('..') || ruta.includes('//') || ruta.includes('\\') || ruta.includes('?') || ruta.includes('#')) return false;
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u001f\u007f]/.test(ruta);
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
