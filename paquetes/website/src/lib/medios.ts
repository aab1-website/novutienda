/** Atributos de imagen responsiva a partir de las versiones por ancho que genera el procesamiento de medios. */
import type { Foto } from '../contenido/tipos.js';

export function srcsetDe(f: Foto): string | undefined {
  if (f.versiones === undefined || f.versiones.length === 0) return undefined;
  return [...f.versiones].sort((a, b) => a.ancho - b.ancho).map((v) => `${v.url} ${v.ancho}w`).join(', ');
}

export const TAMANOS_FICHA = '(min-width: 1024px) 560px, (min-width: 640px) 50vw, 100vw';
/** La grilla es de 2 columnas desde el celular (la imagen ocupa unos 50 vw) y auto-fill desde 640 px. */
export const TAMANOS_TARJETA = '(min-width: 1024px) 360px, 50vw';
