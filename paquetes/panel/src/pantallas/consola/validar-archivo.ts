import { LIMITES_PANEL, type TipoMedio } from '../../api/tipos.js';
import { formatoBytes } from '../../util/base64.js';

// Tope de duración del video: el del panel, que espeja al del módulo (lo compara pruebas/panel/contrato.test.ts).
export const DURACION_VIDEO_MAX_SEG = LIMITES_PANEL.duracionVideoSeg;
/** Espera máxima para leer la duración del video en el navegador; si no se logra, decide el servidor. */
export const ESPERA_METADATOS_MS = 10_000;

const FOTO = { mime: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'], ext: ['jpg', 'jpeg', 'png', 'webp', 'avif'], texto: 'JPG, PNG, WebP o AVIF' } as const;
const VIDEO = { mime: ['video/mp4', 'video/quicktime', 'video/webm'], ext: ['mp4', 'mov', 'webm'], texto: 'MP4, MOV o WebM' } as const;

/** Archivo que se revisa (un `File` lo cumple). */
export type ArchivoAValidar = Pick<File, 'name' | 'size' | 'type'> & Blob;

/** Lee la duración en segundos, o `undefined` si el navegador no puede (el servidor decide entonces). */
export type LectorDuracion = (archivo: Blob) => Promise<number | undefined>;

export function leerDuracionVideo(archivo: Blob, esperaMs = ESPERA_METADATOS_MS): Promise<number | undefined> {
  return new Promise((resolver) => {
    let url: string;
    try {
      url = URL.createObjectURL(archivo);
    } catch {
      resolver(undefined); // sin soporte en este navegador: decide el servidor
      return;
    }
    const v = document.createElement('video');
    let listo = false;
    const reloj = setTimeout(() => fin(undefined), esperaMs);
    function fin(d: number | undefined): void {
      if (listo) return;
      listo = true;
      clearTimeout(reloj);
      URL.revokeObjectURL(url);
      v.removeAttribute('src');
      resolver(d !== undefined && Number.isFinite(d) && d > 0 ? d : undefined);
    }
    v.preload = 'metadata';
    v.onloadedmetadata = (): void => fin(v.duration);
    v.onerror = (): void => fin(undefined);
    v.src = url;
  });
}

/**
 * Revisa el archivo antes de reservar la subida: tipo, tamaño y, en video, duración. Devuelve el mensaje con el motivo y el
 * límite, o `undefined` si puede subirse. Es una comodidad (el servidor vuelve a validar todo con los bytes reales).
 */
export async function validarArchivo(archivo: ArchivoAValidar, tipo: TipoMedio, leer: LectorDuracion = leerDuracionVideo): Promise<string | undefined> {
  const reglas = tipo === 'video' ? VIDEO : FOTO;
  const ext = archivo.name.includes('.') ? (archivo.name.split('.').pop() ?? '').toLowerCase() : '';
  const mimeOk = (reglas.mime as readonly string[]).includes(archivo.type);
  const extOk = (reglas.ext as readonly string[]).includes(ext);
  if (!mimeOk && !(archivo.type === '' && extOk)) {
    return `«${archivo.name}» no es ${tipo === 'video' ? 'un video' : 'una foto'} permitido. Formatos: ${reglas.texto}.`;
  }
  if (archivo.size <= 0) return `«${archivo.name}» está vacío.`;
  const tope = tipo === 'video' ? LIMITES_PANEL.bytesVideo : LIMITES_PANEL.bytesFoto;
  if (archivo.size > tope) {
    return `${tipo === 'video' ? 'El video' : 'La foto'} «${archivo.name}» pesa ${formatoBytes(archivo.size)} y el máximo es ${formatoBytes(tope)}.`;
  }
  if (tipo === 'video') {
    const d = await leer(archivo);
    if (d !== undefined && d > DURACION_VIDEO_MAX_SEG) {
      return `El video «${archivo.name}» dura ${Math.round(d)} segundos y el máximo es ${DURACION_VIDEO_MAX_SEG} segundos.`;
    }
  }
  return undefined;
}
