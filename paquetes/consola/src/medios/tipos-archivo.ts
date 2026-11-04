export type TipoMedio = 'foto' | 'video';
export type FormatoArchivo = 'jpg' | 'png' | 'webp' | 'heic' | 'mp4' | 'mov' | 'webm';

export interface ArchivoDetectado {
  readonly tipo: TipoMedio;
  readonly formato: FormatoArchivo;
}

/** Bytes que se leen del inicio del objeto para decidir su tipo. */
export const BYTES_INICIALES = 64;

const ascii = (b: Uint8Array, desde: number, largo: number): string => {
  let s = '';
  for (let i = desde; i < desde + largo && i < b.length; i += 1) s += String.fromCharCode(b[i] ?? 0);
  return s;
};

const empieza = (b: Uint8Array, firma: readonly number[]): boolean => firma.every((v, i) => b[i] === v);

const MARCAS_HEIC = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs']);
const MARCAS_MP4 = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash', 'M4V ']);

/** Marcas de la caja `ftyp`: la principal y las compatibles (hasta donde alcancen los bytes). */
function marcasFtyp(b: Uint8Array): string[] {
  const tam = (((b[0] ?? 0) << 24) | ((b[1] ?? 0) << 16) | ((b[2] ?? 0) << 8) | (b[3] ?? 0)) >>> 0;
  const fin = Math.min(b.length, tam >= 16 ? tam : b.length);
  const marcas = [ascii(b, 8, 4)];
  for (let i = 16; i + 4 <= fin; i += 4) marcas.push(ascii(b, i, 4));
  return marcas;
}

/**
 * Decide el tipo REAL por los bytes iniciales. No se confía en la extensión ni en el
 * MIME declarados. Devuelve undefined si no es JPG, PNG, WebP, HEIC, MP4, MOV o WebM.
 */
export function detectarArchivo(bytes: Uint8Array): ArchivoDetectado | undefined {
  if (bytes.length >= 3 && empieza(bytes, [0xff, 0xd8, 0xff])) return { tipo: 'foto', formato: 'jpg' };
  if (bytes.length >= 8 && empieza(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { tipo: 'foto', formato: 'png' };
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return { tipo: 'foto', formato: 'webp' };
  if (bytes.length >= 4 && empieza(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    return ascii(bytes, 4, BYTES_INICIALES - 4).includes('webm') ? { tipo: 'video', formato: 'webm' } : undefined;
  }
  if (bytes.length >= 16 && ascii(bytes, 4, 4) === 'ftyp') {
    const marcas = marcasFtyp(bytes);
    const principal = marcas[0] ?? '';
    if (marcas.includes('avif') || marcas.includes('avis')) return undefined; // AVIF no está en la lista permitida
    if (MARCAS_HEIC.has(principal)) return { tipo: 'foto', formato: 'heic' };
    if (principal === 'mif1' || principal === 'msf1') {
      return marcas.some((m) => MARCAS_HEIC.has(m)) ? { tipo: 'foto', formato: 'heic' } : undefined;
    }
    if (principal === 'qt  ') return { tipo: 'video', formato: 'mov' };
    if (MARCAS_MP4.has(principal)) return { tipo: 'video', formato: 'mp4' };
  }
  return undefined;
}
