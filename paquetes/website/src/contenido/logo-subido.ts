/**
 * Logo subido por archivo: `publicado/sitio.logo` (lo escribe la consola) → URL públicas para el sitio.
 * Se valida en el borde: solo URL https del host de medios ya admitido, rutas de la carpeta del negocio; cualquier otra cosa se
 * descarta con aviso (ruta del campo, nunca el valor) y NO tumba la reconstrucción.
 */
import type { Foto } from './tipos.js';
import { urlMedioSegura } from './validar.js';

export interface LogoSubido {
  /** Versión WebP para la cabecera. */
  readonly cabecera: Foto;
  /** Versión PNG para el icono del sitio, si existe. */
  readonly icono: string | null;
  /** Imagen para compartir (PNG si existe; si no, WebP). */
  readonly compartir: string;
}

type Obj = Readonly<Record<string, unknown>>;
const esObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const RE_ARCHIVO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;
// Cabecera de 44 px: la versión WebP más pequeña que cubra 88 px (pantallas densas); si ninguna, la más grande.
const LADO_CABECERA = 88;

interface Version { readonly formato: 'png' | 'webp'; readonly lado: number; readonly url: string }

export function logoDesdePublicado(
  crudo: unknown, base: string, origenMedios: string, nombre: string, advertencias: string[] | undefined,
): LogoSubido | undefined {
  if (crudo === undefined || crudo === null) return undefined;
  const descartar = (motivo: string): undefined => { advertencias?.push(`documentos.sitio.logo: logo descartado (${motivo})`); return undefined; };
  if (!esObj(crudo) || !Array.isArray(crudo['versiones'])) return descartar('forma inválida');
  const versiones: Version[] = [];
  for (const v of crudo['versiones']) {
    if (!esObj(v) || (v['formato'] !== 'png' && v['formato'] !== 'webp') || typeof v['lado'] !== 'number' || !Number.isFinite(v['lado']) || typeof v['ruta'] !== 'string') continue;
    const partes = v['ruta'].split('/');
    const archivo = partes[partes.length - 1] ?? '';
    // tenants/<t>/publico/medios/_negocio/<archivo>
    if (partes.length !== 6 || partes[0] !== 'tenants' || partes[2] !== 'publico' || partes[3] !== 'medios' || partes[4] !== '_negocio' || !RE_ARCHIVO.test(archivo) || archivo.includes('..') || !RE_ARCHIVO.test(partes[1] ?? '')) continue;
    const url = `${base}/${v['ruta']}`;
    if (!url.startsWith('https://') || !urlMedioSegura(url, [origenMedios])) continue;
    versiones.push({ formato: v['formato'], lado: v['lado'], url });
  }
  const webp = versiones.filter((v) => v.formato === 'webp').sort((a, b) => a.lado - b.lado);
  const png = versiones.filter((v) => v.formato === 'png').sort((a, b) => a.lado - b.lado);
  const principal = webp.find((v) => v.lado >= LADO_CABECERA) ?? webp[webp.length - 1];
  if (principal === undefined) return descartar('sin versión WebP válida');
  const icono = png.find((v) => v.lado >= 64) ?? png[png.length - 1];
  const compartir = png[png.length - 1] ?? principal;
  return {
    cabecera: { url: principal.url, alt: nombre === '' ? 'Logo' : nombre.slice(0, 200) },
    icono: icono?.url ?? null,
    compartir: compartir.url,
  };
}

/** og:image: la foto propia de la página; solo si no la tiene, el logo subido. */
export const imagenAlCompartir = (fotoPagina: string | undefined, logoCompartir: string | null | undefined): string | undefined =>
  fotoPagina ?? logoCompartir ?? undefined;

/** Icono del sitio: el PNG del logo subido; si no hay, el logo de cabecera (comportamiento anterior); sin logo, ninguno. */
export const iconoDelSitio = (iconoSitio: string | null | undefined, logo: { readonly url: string } | null): string | undefined =>
  iconoSitio ?? logo?.url ?? undefined;
