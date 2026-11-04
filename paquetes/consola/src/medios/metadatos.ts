const ascii = (b: Uint8Array, desde: number, largo: number): string => {
  let s = '';
  for (let i = desde; i < desde + largo && i < b.length; i += 1) s += String.fromCharCode(b[i] ?? 0);
  return s;
};
const u32be = (b: Uint8Array, i: number): number => (((b[i] ?? 0) << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0)) >>> 0;
const u32le = (b: Uint8Array, i: number): number => (((b[i + 3] ?? 0) << 24) | ((b[i + 2] ?? 0) << 16) | ((b[i + 1] ?? 0) << 8) | (b[i] ?? 0)) >>> 0;

function jpeg(b: Uint8Array): boolean {
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return false;
    const marca = b[i + 1] ?? 0;
    if (marca === 0xff) {
      i += 1;
      continue;
    }
    if (marca === 0xda || marca === 0xd9) return false; // comienzo de datos de imagen: ya no hay metadatos
    const largo = ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0);
    if (marca === 0xe1) {
      const cab = ascii(b, i + 4, 29);
      if (cab.startsWith('Exif\0') || cab.startsWith('http://ns.adobe.com/xap')) return true;
    }
    if (marca === 0xed) return true; // APP13: IPTC / Photoshop
    i += 2 + largo;
  }
  return false;
}

function png(b: Uint8Array): boolean {
  let i = 8;
  while (i + 8 <= b.length) {
    const largo = u32be(b, i);
    const tipo = ascii(b, i + 4, 4);
    if (tipo === 'eXIf') return true;
    if (tipo === 'iTXt' && ascii(b, i + 8, 17) === 'XML:com.adobe.xmp') return true;
    if (tipo === 'IDAT' || tipo === 'IEND') return false;
    i += 12 + largo;
  }
  return false;
}

function webp(b: Uint8Array): boolean {
  let i = 12;
  while (i + 8 <= b.length) {
    const tipo = ascii(b, i, 4);
    if (tipo === 'EXIF' || tipo === 'XMP ') return true;
    i += 8 + u32le(b, i + 4) + (u32le(b, i + 4) % 2);
  }
  return false;
}

/**
 * Detecta metadatos que no deben publicarse (EXIF con GPS, XMP, IPTC) en una imagen YA procesada.
 * Es una verificación de defensa en profundidad: el procesador debe quitarlos; si quedan, se rechaza.
 * En contenedores ISO (AVIF/HEIC) se busca el elemento `Exif` o un `mime` XMP.
 */
export function contieneMetadatos(bytes: Uint8Array): boolean {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpeg(bytes);
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') return png(bytes);
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return webp(bytes);
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const t = ascii(bytes, 0, bytes.length);
    return t.includes('Exif') || t.includes('XML:com.adobe.xmp') || t.includes('application/rdf+xml');
  }
  return false;
}
