import type { TipoMedio } from './tipos-archivo.js';

export const ANCHOS_FOTO = [480, 960, 1600, 2400] as const;
export const FORMATOS_FOTO = ['avif', 'webp'] as const;
export const ALTURAS_VIDEO = [720, 1080] as const;
export const ANCHO_POSTER = 1280;

export interface ItemPlan {
  readonly clase: 'imagen' | 'video' | 'poster';
  /** Ancho (imagen, póster) o altura del lado corto (video), en píxeles. */
  readonly lado: number;
  readonly formato: 'avif' | 'webp' | 'mp4';
}

export interface PlanProcesamiento {
  readonly tipo: TipoMedio;
  /** Siempre verdadero: EXIF, GPS, XMP e IPTC se eliminan de toda salida. */
  readonly quitarMetadatos: true;
  readonly items: readonly ItemPlan[];
}

/**
 * Plan de procesamiento. Nunca se amplía más allá del original. Fotos: 480/960/1600/2400 de
 * ancho en AVIF y WebP. Video: 720p/1080p (sobre el lado corto, para que el vertical también
 * cuente) en MP4 más un póster WebP.
 */
export function planificarProcesamiento(tipo: TipoMedio, ancho: number, alto: number): PlanProcesamiento {
  if (!Number.isInteger(ancho) || !Number.isInteger(alto) || ancho < 1 || alto < 1) {
    throw new RangeError('dimensiones inválidas');
  }
  const items: ItemPlan[] = [];
  if (tipo === 'foto') {
    const anchos = ANCHOS_FOTO.filter((a) => a <= ancho);
    const usados: number[] = anchos.length > 0 ? anchos : [ancho];
    for (const lado of usados) for (const formato of FORMATOS_FOTO) items.push({ clase: 'imagen', lado, formato });
  } else {
    const corto = Math.min(ancho, alto);
    const alturas = ALTURAS_VIDEO.filter((a) => a <= corto);
    const usadas: number[] = alturas.length > 0 ? alturas : [corto];
    for (const lado of usadas) items.push({ clase: 'video', lado, formato: 'mp4' });
    items.push({ clase: 'poster', lado: Math.min(ANCHO_POSTER, ancho), formato: 'webp' });
  }
  return { tipo, quitarMetadatos: true, items };
}

export const HASH = /^[a-f0-9]{64}$/;

/** Nombre público con hash del contenido: cambia si cambia el contenido, así la caché puede ser inmutable. */
export function nombreVersion(hashContenido: string, item: ItemPlan): string {
  if (!HASH.test(hashContenido)) throw new RangeError('hash de contenido inválido');
  return `${hashContenido.slice(0, 32)}-${item.clase}${String(item.lado)}.${item.formato}`;
}
