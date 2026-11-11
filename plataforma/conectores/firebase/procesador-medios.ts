// `ProcesadorMedios` de la consola. Imágenes con sharp (anchos del plan en AVIF y WebP, sin EXIF/GPS/XMP/IPTC,
// con tope de píxeles contra imágenes «bomba»). Video con ffmpeg/ffprobe del runtime de Google (ffmpeg 4.4 en
// /usr/bin; las rutas llegan por `FFMPEG_PATH` y `FFPROBE_PATH`). Que el binario exista y traiga libx264 se
// confirma con una sonda por instancia; sin eso el video se rechaza con un error claro y nunca se publica algo a
// medias. El archivo del usuario es no confiable: sin shell, sin entorno heredado, solo protocolo `file`, demuxer
// forzado según ffprobe, una pista de video y una de audio, y tope de tamaño de salida.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { ArchivoNoAdmitido, ProcesamientoNoDisponible, type InfoMedio, type ProcesadorMedios, type SolicitudProcesado, type VersionProcesada } from '@novutienda/consola';
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

/** Video no disponible por una causa ajena al archivo (sin binarios, sin libx264). */
export class VideoNoDisponible extends ProcesamientoNoDisponible {
  constructor(mensaje = 'El procesamiento de video no está disponible en este entorno') {
    super(mensaje);
    this.name = 'VideoNoDisponible';
  }
}

/** El archivo no es un contenedor admitido: lo rechaza la inspección con un texto para el usuario. */
export class FormatoVideoNoAdmitido extends ArchivoNoAdmitido {
  constructor() {
    super('Formato de video no admitido: use MP4, MOV o WebM');
    this.name = 'FormatoVideoNoAdmitido';
  }
}

export type EstadoVideo =
  | { readonly disponible: true; readonly version: string }
  | { readonly disponible: false; readonly causa: string; readonly version?: string };

/** Entorno mínimo de los subprocesos: sin heredar nada (ni credenciales ni variables de ffmpeg). */
const ENTORNO_BIN = { PATH: '/usr/bin:/bin' };

/**
 * Sonda del ffmpeg: existe, ejecuta y trae libx264. El resultado se guarda por instancia (una sola corrida).
 */
export function sondaVideo(bin: BinariosVideo): () => Promise<EstadoVideo> {
  let guardada: Promise<EstadoVideo> | undefined;
  const sondear = async (): Promise<EstadoVideo> => {
    let version: string | undefined;
    try {
      const v = await ejecutar(bin.ffmpeg, ['-hide_banner', '-version'], { timeout: 15_000, maxBuffer: 1024 * 1024, env: ENTORNO_BIN });
      version = v.stdout.split('\n')[0]?.trim();
      const e = await ejecutar(bin.ffmpeg, ['-hide_banner', '-encoders'], { timeout: 15_000, maxBuffer: 4 * 1024 * 1024, env: ENTORNO_BIN });
      if (!/\blibx264\b/.test(e.stdout)) return { disponible: false, causa: 'ffmpeg sin libx264', ...(version === undefined ? {} : { version }) };
      return { disponible: true, version: version ?? 'desconocida' };
    } catch (err) {
      const codigo = (err as { code?: unknown }).code;
      return { disponible: false, causa: `ffmpeg no ejecuta (${typeof codigo === 'string' || typeof codigo === 'number' ? String(codigo) : 'error'})`, ...(version === undefined ? {} : { version }) };
    }
  };
  return () => (guardada ??= sondear());
}

interface SalidaProbe {
  readonly streams?: readonly { readonly codec_type?: string; readonly width?: number; readonly height?: number; readonly duration?: string }[];
  readonly format?: { readonly duration?: string; readonly format_name?: string };
}

const FAMILIA_MP4 = ['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2'];
const FAMILIA_MATROSKA = ['matroska', 'webm'];

/** Demuxer a forzar según el `format_name` de ffprobe; `undefined` si no es mov/mp4 ni matroska/webm. */
export function demuxerPermitido(formatName: string | undefined): string | undefined {
  const nombres = (formatName ?? '').split(',');
  if (nombres.length > 0 && nombres.every((n) => FAMILIA_MP4.includes(n))) return 'mov,mp4,m4a,3gp,3g2,mj2';
  if (nombres.length > 0 && nombres.every((n) => FAMILIA_MATROSKA.includes(n))) return 'matroska,webm';
  return undefined;
}

/** Tope de bytes de cada archivo de salida de ffmpeg (el límite de la consola para una versión es menor). */
const SALIDA_MAX_BYTES = 200 * 1024 * 1024;
/** Opciones de entrada comunes: sin stdin y solo archivos locales. */
const ENTRADA_SEGURA = ['-nostdin', '-protocol_whitelist', 'file'];

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

  async function sondear(local: string): Promise<{ readonly sonda: SalidaProbe; readonly demuxer: string }> {
    const { stdout } = await ejecutar(
      bin.ffprobe,
      ['-v', 'error', '-protocol_whitelist', 'file', '-print_format', 'json', '-show_format', '-show_streams', local],
      { timeout: 60_000, maxBuffer: 4 * 1024 * 1024, env: ENTORNO_BIN },
    );
    const sonda = JSON.parse(stdout) as SalidaProbe;
    const demuxer = demuxerPermitido(sonda.format?.format_name);
    if (demuxer === undefined) throw new FormatoVideoNoAdmitido();
    return { sonda, demuxer };
  }

  const correr = (args: readonly string[], timeout: number): Promise<unknown> => ejecutar(bin.ffmpeg, [...args], { timeout, maxBuffer: 1024 * 1024, env: ENTORNO_BIN });

  return {
    inspeccionar: (ruta): Promise<InfoMedio> =>
      conArchivo(ruta, async (local) => {
        const { sonda: p } = await sondear(local);
        const v = p.streams?.find((s) => s.codec_type === 'video');
        if (v?.width === undefined || v.height === undefined) throw new Error('el archivo no tiene pista de video');
        const dur = Number(p.format?.duration ?? v.duration);
        return { ancho: v.width, alto: v.height, ...(Number.isFinite(dur) ? { duracionSeg: dur } : {}) };
      }),

    procesar: (s: SolicitudProcesado): Promise<readonly VersionProcesada[]> =>
      conArchivo(s.origen, async (local, dir) => {
        const { demuxer } = await sondear(local);
        const entrada = [...ENTRADA_SEGURA, '-f', demuxer, '-i', local];
        const salida: VersionProcesada[] = [];
        for (const item of s.plan.items) {
          if (item.clase === 'video') {
            // El lado lo mide el lado corto: en vertical se fija el ancho, en horizontal el alto.
            const lado = String(item.lado);
            const filtro = `scale=w='if(gt(iw,ih),-2,${lado})':h='if(gt(iw,ih),${lado},-2)'`;
            const destino = join(dir, `video${lado}.mp4`);
            await correr(
              ['-y', '-v', 'error', ...entrada, '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1', '-vf', filtro, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-fs', String(SALIDA_MAX_BYTES), destino],
              480_000,
            );
            const rutaTemporal = `${s.destinoTemporal}/video${lado}.mp4`;
            await subir(bucket, rutaTemporal, await readFile(destino), TIPO_CONTENIDO.mp4);
            salida.push({ clase: 'video', lado: item.lado, formato: 'mp4', rutaTemporal });
          } else if (item.clase === 'poster') {
            const cuadro = join(dir, 'cuadro.png');
            const base = ['-y', '-v', 'error'];
            const salidaPoster = ['-map', '0:v:0', '-an', '-sn', '-dn', '-frames:v', '1', '-fs', String(SALIDA_MAX_BYTES), cuadro];
            await correr([...base, '-ss', '0.5', ...entrada, ...salidaPoster], 60_000).catch(() => correr([...base, ...entrada, ...salidaPoster], 60_000));
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

/** Procesador de la consola con la sonda de video expuesta (para registrar el estado al crear el entorno). */
export type ProcesadorMediosConSonda = ProcesadorMedios & { readonly estadoVideo: () => Promise<EstadoVideo> };

/**
 * Procesador de la consola: fotos con sharp; video con ffmpeg si hay binarios con libx264, y si no, error claro.
 */
export function crearProcesadorMedios(bucket: Bucket, env: Readonly<Record<string, string | undefined>> = {}): ProcesadorMediosConSonda {
  const imagenes = procesadorImagenes(bucket);
  const bin = binariosDeVideo(env);
  const video = bin === undefined ? undefined : procesadorVideo(bucket, bin);
  const sonda = bin === undefined ? undefined : sondaVideo(bin);
  const estadoVideo = async (): Promise<EstadoVideo> => (sonda === undefined ? { disponible: false, causa: 'faltan FFMPEG_PATH y FFPROBE_PATH' } : sonda());
  const elegirVideo = async (): Promise<Pick<ProcesadorMedios, 'inspeccionar' | 'procesar'>> => {
    const e = await estadoVideo();
    if (video === undefined || !e.disponible) throw new VideoNoDisponible();
    return video;
  };
  return {
    estadoVideo,
    disponible: async (tipo) => tipo === 'foto' || (await estadoVideo()).disponible,
    inspeccionar: async (ruta, tipo) => (tipo === 'foto' ? imagenes : await elegirVideo()).inspeccionar(ruta, tipo),
    procesar: async (s) => (s.tipo === 'foto' ? imagenes : await elegirVideo()).procesar(s),
  };
}
