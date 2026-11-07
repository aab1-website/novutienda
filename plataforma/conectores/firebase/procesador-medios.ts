// `ProcesadorMedios` de la consola. Imágenes con sharp (anchos del plan en AVIF y WebP, sin EXIF/GPS/XMP/IPTC,
// con tope de píxeles contra imágenes «bomba»). Video con ffmpeg/ffprobe SOLO si el entorno entrega los
// binarios (`FFMPEG_PATH`, `FFPROBE_PATH`): el runtime de Cloud Functions no los trae, así que sin ellos el
// video se rechaza con un error claro y nunca se publica algo a medias.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import type { InfoMedio, ProcesadorMedios, SolicitudProcesado, VersionProcesada } from '@novutienda/consola';
import type { Bucket } from './almacen-medios.js';

const ejecutar = promisify(execFile);

/** Tope de píxeles de una imagen de entrada (100 megapíxeles, el mismo de la consola). */
export const PIXELES_MAX = 100_000_000;
/** Tope de bytes que se descargan para inspeccionar una foto (la consola ya limita a 15 MB). */
const BYTES_MAX_FOTO = 16 * 1024 * 1024;

const opcionesSharp = { limitInputPixels: PIXELES_MAX, failOn: 'error' as const };

async function descargar(bucket: Bucket, ruta: string, maximo: number): Promise<Buffer> {
  const [meta] = await bucket.file(ruta).getMetadata();
  if (Number(meta.size) > maximo) throw new RangeError('el objeto supera el tamaño máximo de procesamiento');
  const [bytes] = await bucket.file(ruta).download();
  return bytes;
}

async function subir(bucket: Bucket, ruta: string, bytes: Buffer, contentType: string): Promise<void> {
  await bucket.file(ruta).save(bytes, { contentType, resumable: false });
}

const TIPO_CONTENIDO = { avif: 'image/avif', webp: 'image/webp', mp4: 'video/mp4' } as const;

export function procesadorImagenes(bucket: Bucket): Pick<ProcesadorMedios, 'inspeccionar' | 'procesar'> {
  return {
    async inspeccionar(ruta) {
      const buf = await descargar(bucket, ruta, BYTES_MAX_FOTO);
      const m = await sharp(buf, opcionesSharp).metadata();
      if (m.width === undefined || m.height === undefined) throw new Error('imagen sin dimensiones');
      // Las orientaciones 5 a 8 giran la imagen 90°: las dimensiones útiles son las orientadas.
      const girada = (m.orientation ?? 1) >= 5;
      return { ancho: girada ? m.height : m.width, alto: girada ? m.width : m.height };
    },

    async procesar(s: SolicitudProcesado): Promise<readonly VersionProcesada[]> {
      const buf = await descargar(bucket, s.origen, BYTES_MAX_FOTO);
      const salida: VersionProcesada[] = [];
      for (const item of s.plan.items) {
        if (item.clase !== 'imagen' || (item.formato !== 'avif' && item.formato !== 'webp')) throw new Error('el plan de una foto solo admite imágenes AVIF o WebP');
        // `rotate()` aplica la orientación EXIF; sharp descarta todos los metadatos salvo que se pida conservarlos.
        const base = sharp(buf, opcionesSharp).rotate().resize({ width: item.lado, withoutEnlargement: true });
        const bytes = item.formato === 'avif' ? await base.avif({ quality: 55, effort: 4 }).toBuffer() : await base.webp({ quality: 80 }).toBuffer();
        const rutaTemporal = `${s.destinoTemporal}/imagen${String(item.lado)}.${item.formato}`;
        await subir(bucket, rutaTemporal, bytes, TIPO_CONTENIDO[item.formato]);
        salida.push({ clase: 'imagen', lado: item.lado, formato: item.formato, rutaTemporal });
      }
      return salida;
    },
  };
}

export interface BinariosVideo {
  readonly ffmpeg: string;
  readonly ffprobe: string;
}

/** Binarios de video declarados por el entorno, o `undefined` si faltan (video no disponible). */
export function binariosDeVideo(env: Readonly<Record<string, string | undefined>>): BinariosVideo | undefined {
  const ffmpeg = env['FFMPEG_PATH'];
  const ffprobe = env['FFPROBE_PATH'];
  return ffmpeg !== undefined && ffmpeg !== '' && ffprobe !== undefined && ffprobe !== '' ? { ffmpeg, ffprobe } : undefined;
}

interface SalidaProbe {
  readonly streams?: readonly { readonly codec_type?: string; readonly width?: number; readonly height?: number; readonly duration?: string }[];
  readonly format?: { readonly duration?: string };
}

export function procesadorVideo(bucket: Bucket, bin: BinariosVideo): Pick<ProcesadorMedios, 'inspeccionar' | 'procesar'> {
  async function conArchivo<T>(ruta: string, fn: (local: string, dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), 'video-'));
    try {
      const local = join(dir, 'origen');
      await bucket.file(ruta).download({ destination: local });
      return await fn(local, dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  return {
    inspeccionar: (ruta): Promise<InfoMedio> =>
      conArchivo(ruta, async (local) => {
        const { stdout } = await ejecutar(bin.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', local], { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
        const p = JSON.parse(stdout) as SalidaProbe;
        const v = p.streams?.find((s) => s.codec_type === 'video');
        if (v?.width === undefined || v.height === undefined) throw new Error('el archivo no tiene pista de video');
        const dur = Number(p.format?.duration ?? v.duration);
        return { ancho: v.width, alto: v.height, ...(Number.isFinite(dur) ? { duracionSeg: dur } : {}) };
      }),

    procesar: (s: SolicitudProcesado): Promise<readonly VersionProcesada[]> =>
      conArchivo(s.origen, async (local, dir) => {
        const salida: VersionProcesada[] = [];
        for (const item of s.plan.items) {
          if (item.clase === 'video') {
            // El lado lo mide el lado corto: en vertical se fija el ancho, en horizontal el alto.
            const lado = String(item.lado);
            const filtro = `scale=w='if(gt(iw,ih),-2,${lado})':h='if(gt(iw,ih),${lado},-2)'`;
            const destino = join(dir, `video${lado}.mp4`);
            await ejecutar(
              bin.ffmpeg,
              ['-y', '-v', 'error', '-i', local, '-map_metadata', '-1', '-map_chapters', '-1', '-vf', filtro, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', destino],
              { timeout: 480_000 },
            );
            const rutaTemporal = `${s.destinoTemporal}/video${lado}.mp4`;
            await subir(bucket, rutaTemporal, await readFile(destino), TIPO_CONTENIDO.mp4);
            salida.push({ clase: 'video', lado: item.lado, formato: 'mp4', rutaTemporal });
          } else if (item.clase === 'poster') {
            const cuadro = join(dir, 'cuadro.png');
            await ejecutar(bin.ffmpeg, ['-y', '-v', 'error', '-ss', '0.5', '-i', local, '-frames:v', '1', cuadro], { timeout: 60_000 }).catch(() =>
              ejecutar(bin.ffmpeg, ['-y', '-v', 'error', '-i', local, '-frames:v', '1', cuadro], { timeout: 60_000 }),
            );
            const bytes = await sharp(await readFile(cuadro), opcionesSharp).rotate().resize({ width: item.lado, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
            const rutaTemporal = `${s.destinoTemporal}/poster${String(item.lado)}.webp`;
            await subir(bucket, rutaTemporal, bytes, TIPO_CONTENIDO.webp);
            salida.push({ clase: 'poster', lado: item.lado, formato: 'webp', rutaTemporal });
          } else throw new Error('el plan de un video solo admite video y póster');
        }
        return salida;
      }),
  };
}

/** Video no disponible: rechaza con un error propio en lugar de publicar algo simulado. */
export class VideoNoDisponible extends Error {
  constructor() {
    super('El procesamiento de video no está disponible en este entorno');
    this.name = 'VideoNoDisponible';
  }
}

/**
 * Procesador de la consola: fotos con sharp; video con ffmpeg si hay binarios, y si no, error claro.
 */
export function crearProcesadorMedios(bucket: Bucket, env: Readonly<Record<string, string | undefined>> = {}): ProcesadorMedios {
  const imagenes = procesadorImagenes(bucket);
  const bin = binariosDeVideo(env);
  const video = bin === undefined ? undefined : procesadorVideo(bucket, bin);
  const elegir = (tipo: 'foto' | 'video'): Pick<ProcesadorMedios, 'inspeccionar' | 'procesar'> => {
    if (tipo === 'foto') return imagenes;
    if (video === undefined) throw new VideoNoDisponible();
    return video;
  };
  return {
    inspeccionar: async (ruta, tipo) => elegir(tipo).inspeccionar(ruta, tipo),
    procesar: async (s) => elegir(s.tipo).procesar(s),
  };
}
