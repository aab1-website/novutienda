import { LIMITES_PANEL, type TipoMedio } from "../../api/tipos.js";
import { formatoBytes } from "../../util/base64.js";

// Tope de duración del video: el del panel, que espeja al del módulo (lo compara pruebas/panel/contrato.test.ts).
export const DURACION_VIDEO_MAX_SEG = LIMITES_PANEL.duracionVideoSeg;

// Formatos que admite el servidor: la fuente de verdad es paquetes/consola/src/medios/tipos-archivo.ts (detecta por bytes
// JPG, PNG, WebP, HEIC/HEIF, MP4/M4V, MOV y WebM; rechaza AVIF). Aquí solo se refleja para avisar antes de subir.
const FOTO = {
  mime: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
  ext: ["jpg", "jpeg", "png", "webp", "heic", "heif"],
  texto: "JPG, PNG, WebP o HEIC",
} as const;
const VIDEO = {
  mime: ["video/mp4", "video/x-m4v", "video/quicktime", "video/webm"],
  ext: ["mp4", "m4v", "mov", "webm"],
  texto: "MP4, MOV o WebM",
} as const;
/** MIME que el navegador pone cuando no reconoce el archivo: se decide por la extensión. */
const MIME_GENERICOS: readonly string[] = ["", "application/octet-stream"];

/** Archivo que se revisa (un `File` lo cumple). */
export type ArchivoAValidar = Pick<File, "name" | "size" | "type"> & Blob;

/** Lee la duración en segundos, o `undefined` si el navegador no puede (el servidor decide entonces). */
export type LectorDuracion = (archivo: Blob) => Promise<number | undefined>;

/** Topes de lectura: nunca se lee el archivo entero. */
const TOPE_LECTURA_BYTES = 2 * 1024 * 1024;
const TOPE_EBML_BYTES = 1024 * 1024;
const MAX_SALTOS = 64;

class FueraDeTope extends Error {}

/** Lector acotado por trozos (`Blob.slice(...).arrayBuffer()`): cuenta bytes y lecturas, y corta al pasar los topes. */
class Trozos {
  private leidos = 0;
  private saltos = 0;
  constructor(private readonly archivo: Blob) {}
  get tamano(): number {
    return this.archivo.size;
  }
  async leer(desde: number, largo: number): Promise<DataView> {
    const hasta = Math.min(desde + largo, this.archivo.size);
    if (!Number.isSafeInteger(desde) || desde < 0 || hasta <= desde)
      throw new FueraDeTope();
    this.saltos += 1;
    this.leidos += hasta - desde;
    if (this.saltos > MAX_SALTOS || this.leidos > TOPE_LECTURA_BYTES)
      throw new FueraDeTope();
    return new DataView(await this.archivo.slice(desde, hasta).arrayBuffer());
  }
}

function tipoCaja(v: DataView, o: number): string {
  return String.fromCharCode(
    v.getUint8(o),
    v.getUint8(o + 1),
    v.getUint8(o + 2),
    v.getUint8(o + 3),
  );
}
function u64(v: DataView, o: number): number {
  const n = v.getBigUint64(o);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new FueraDeTope();
  return Number(n);
}

/** Cabecera de una caja ISO BMFF en `desde`: tipo, largo de la cabecera y tamaño total (0 = hasta `fin`). */
async function cabeceraCaja(
  t: Trozos,
  desde: number,
  fin: number,
): Promise<{ tipo: string; cab: number; total: number }> {
  const v = await t.leer(desde, 16);
  if (v.byteLength < 8) throw new FueraDeTope();
  const s32 = v.getUint32(0);
  const tipo = tipoCaja(v, 4);
  let cab = 8;
  let total = s32;
  if (s32 === 1) {
    if (v.byteLength < 16) throw new FueraDeTope();
    cab = 16;
    total = u64(v, 8);
  } else if (s32 === 0) {
    total = fin - desde;
  }
  if (total < cab || desde + total > fin) throw new FueraDeTope();
  return { tipo, cab, total };
}

async function duracionIso(t: Trozos): Promise<number | undefined> {
  let o = 0;
  const fin = t.tamano;
  while (o < fin) {
    const c = await cabeceraCaja(t, o, fin);
    if (c.tipo === "moov") {
      let h = o + c.cab;
      const finMoov = o + c.total;
      while (h < finMoov) {
        const hijo = await cabeceraCaja(t, h, finMoov);
        if (hijo.tipo === "mvhd") {
          const v = await t.leer(h + hijo.cab, 32);
          if (v.byteLength < 20) return undefined;
          const version = v.getUint8(0);
          let escala: number;
          let dur: number;
          if (version === 0) {
            escala = v.getUint32(12);
            dur = v.getUint32(16);
          } else if (version === 1) {
            if (v.byteLength < 32) return undefined;
            escala = v.getUint32(20);
            dur = u64(v, 24);
          } else return undefined;
          return escala > 0 ? dur / escala : undefined;
        }
        h += hijo.total;
      }
      return undefined;
    }
    o += c.total;
  }
  return undefined;
}

/** Entero de longitud variable EBML: `marca` conserva el bit de longitud (ids); `desconocido` = todos los bits en 1. */
function vint(
  v: DataView,
  o: number,
  marca: boolean,
): { valor: number; largo: number; desconocido: boolean } {
  if (o >= v.byteLength) throw new FueraDeTope();
  const b = v.getUint8(o);
  let largo = 1;
  while (largo <= 8 && (b & (0x100 >> largo)) === 0) largo += 1;
  if (largo > 8 || o + largo > v.byteLength) throw new FueraDeTope();
  if (marca && largo > 4) throw new FueraDeTope();
  let valor = marca ? b : b & (0xff >> largo);
  let unos = (b & (0xff >> largo)) === 0xff >> largo;
  for (let i = 1; i < largo; i += 1) {
    const x = v.getUint8(o + i);
    if (x !== 0xff) unos = false;
    valor = valor * 256 + x;
  }
  const desconocido = !marca && unos;
  if (desconocido) return { valor: 0, largo, desconocido };
  if (!Number.isSafeInteger(valor)) throw new FueraDeTope();
  return { valor, largo, desconocido };
}

const ID_EBML = 0x1a45dfa3;
const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_ESCALA = 0x2ad7b1;
const ID_DURACION = 0x4489;

function elemento(
  v: DataView,
  o: number,
): { id: number; datos: number; tam: number; desconocido: boolean } {
  const id = vint(v, o, true);
  const tam = vint(v, o + id.largo, false);
  return {
    id: id.valor,
    datos: o + id.largo + tam.largo,
    tam: tam.valor,
    desconocido: tam.desconocido,
  };
}

async function duracionEbml(t: Trozos): Promise<number | undefined> {
  const v = await t.leer(0, TOPE_EBML_BYTES);
  let o = 0;
  let segmento = false;
  let fin = v.byteLength;
  while (o < fin) {
    const e = elemento(v, o);
    if (e.id === ID_SEGMENT) {
      segmento = true;
      o = e.datos; // se entra: sus hijos siguen en el flujo, con tamaño conocido o no
      if (!e.desconocido) fin = Math.min(fin, e.datos + e.tam);
      continue;
    }
    if (e.desconocido || e.datos + e.tam > v.byteLength) {
      if (e.id === ID_INFO && segmento) return undefined;
      throw new FueraDeTope();
    }
    if (e.id === ID_INFO && segmento) {
      let escala = 1_000_000;
      let dur: number | undefined;
      let h = e.datos;
      const finInfo = e.datos + e.tam;
      while (h < finInfo) {
        const x = elemento(v, h);
        if (x.desconocido || x.datos + x.tam > finInfo) return undefined;
        if (x.id === ID_ESCALA && x.tam >= 1 && x.tam <= 6) {
          escala = 0;
          for (let i = 0; i < x.tam; i += 1)
            escala = escala * 256 + v.getUint8(x.datos + i);
        } else if (x.id === ID_DURACION) {
          if (x.tam === 4) dur = v.getFloat32(x.datos);
          else if (x.tam === 8) dur = v.getFloat64(x.datos);
          else return undefined;
        }
        h = x.datos + x.tam;
      }
      return dur === undefined ? undefined : (dur * escala) / 1e9;
    }
    o = e.datos + e.tam;
  }
  return undefined;
}

/**
 * Lee la duración en segundos de un MP4/MOV/M4V (`mvhd`) o WebM (`Info/Duration`) sin DOM ni URL de objeto: solo trozos
 * del archivo con `Blob.slice`. Cualquier estructura inesperada o superación de los topes da `undefined` (decide el
 * servidor); nunca lanza.
 */
export async function leerDuracionVideo(
  archivo: Blob,
): Promise<number | undefined> {
  try {
    const t = new Trozos(archivo);
    const cab = await t.leer(0, 8);
    const d =
      cab.byteLength >= 4 && cab.getUint32(0) === ID_EBML
        ? await duracionEbml(new Trozos(archivo))
        : await duracionIso(t);
    return d !== undefined && Number.isFinite(d) && d > 0 ? d : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Revisa el archivo antes de reservar la subida: tipo, tamaño y, en video, duración. Devuelve el mensaje con el motivo y el
 * límite, o `undefined` si puede subirse. Es una comodidad (el servidor vuelve a validar todo con los bytes reales).
 */
export async function validarArchivo(
  archivo: ArchivoAValidar,
  tipo: TipoMedio,
  leer: LectorDuracion = leerDuracionVideo,
): Promise<string | undefined> {
  const reglas = tipo === "video" ? VIDEO : FOTO;
  const ext = archivo.name.includes(".")
    ? (archivo.name.split(".").pop() ?? "").toLowerCase()
    : "";
  const mimeOk = (reglas.mime as readonly string[]).includes(archivo.type);
  const extOk = (reglas.ext as readonly string[]).includes(ext);
  if (!mimeOk && !(MIME_GENERICOS.includes(archivo.type) && extOk)) {
    return `«${archivo.name}» no es ${tipo === "video" ? "un video" : "una foto"} permitido. Formatos: ${reglas.texto}.`;
  }
  if (archivo.size <= 0) return `«${archivo.name}» está vacío.`;
  const tope =
    tipo === "video" ? LIMITES_PANEL.bytesVideo : LIMITES_PANEL.bytesFoto;
  if (archivo.size > tope) {
    return `${tipo === "video" ? "El video" : "La foto"} «${archivo.name}» pesa ${formatoBytes(archivo.size)} y el máximo es ${formatoBytes(tope)}.`;
  }
  if (tipo === "video") {
    const d = await leer(archivo);
    if (d !== undefined && d > DURACION_VIDEO_MAX_SEG) {
      return `El video «${archivo.name}» dura ${Math.ceil(d)} segundos y el máximo es ${DURACION_VIDEO_MAX_SEG} segundos.`;
    }
  }
  return undefined;
}
