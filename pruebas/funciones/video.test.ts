// Procesador de video con ffmpeg/ffprobe REALES. Solo corre si la máquina trae los binarios con libx264; en
// Cloud Functions no están garantizados (ver docs/produccion/funciones.md), así que esta suite documenta
// y prueba la implementación para cuando el despliegue los empaquete.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { planificarProcesamiento } from '@novutienda/consola';
import { RUTA_PUBLICA, binariosDeVideo, crearAlmacenMedios, crearProcesadorMedios, procesadorVideo } from '../../plataforma/conectores/firebase/index.js';
import { hayEmuladorStorage, herramientas, unico } from './ayudas.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const FFMPEG = process.env['FFMPEG_PATH'] ?? '/usr/bin/ffmpeg';
const FFPROBE = process.env['FFPROBE_PATH'] ?? '/usr/bin/ffprobe';

function hayFfmpeg(): boolean {
  try {
    return execFileSync(FFMPEG, ['-hide_banner', '-encoders'], { encoding: 'utf8' }).includes('libx264');
  } catch {
    return false;
  }
}

// Con VIDEO_EXIGIDO=1 (CI) la ausencia de ffmpeg con libx264 es un fallo, no un salto silencioso.
const EXIGIDO = process.env['VIDEO_EXIGIDO'] === '1';

describe('binarios de video', () => {
  it.runIf(EXIGIDO)('VIDEO_EXIGIDO=1: hay ffmpeg con libx264', () => {
    expect(hayFfmpeg(), `falta ffmpeg con libx264 en ${FFMPEG}`).toBe(true);
  });

  it('solo se habilita con ambas rutas', () => {
    expect(binariosDeVideo({})).toBeUndefined();
    expect(binariosDeVideo({ FFMPEG_PATH: '/x/ffmpeg' })).toBeUndefined();
    expect(binariosDeVideo({ FFMPEG_PATH: '/x/ffmpeg', FFPROBE_PATH: '/x/ffprobe' })).toEqual({ ffmpeg: '/x/ffmpeg', ffprobe: '/x/ffprobe' });
    expect(binariosDeVideo({ FFMPEG_PATH: '', FFPROBE_PATH: '' })).toBeUndefined();
  });
});

describe.skipIf(!hayEmuladorStorage || !hayFfmpeg())('procesador de video (ffmpeg real + Storage del emulador)', () => {
  it('inspecciona, genera 720p y 1080p en MP4 sin metadatos y el póster WebP', async () => {
    const h = herramientas();
    const dir = mkdtempSync(join(tmpdir(), 'v-'));
    try {
      const origen = join(dir, 'entrada.mp4');
      // 3 s, 1920 × 1080, con un título en los metadatos que NO debe sobrevivir.
      execFileSync(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=3:size=1920x1080:rate=10', '-pix_fmt', 'yuv420p', '-metadata', 'title=DATO-PRIVADO', origen]);
      const base = `pruebas/${unico('vid')}`;
      await h.bucket.file(`${base}/entrada.mp4`).save(readFileSync(origen), { contentType: 'video/mp4', resumable: false });
      const p = procesadorVideo(h.bucket, { ffmpeg: FFMPEG, ffprobe: FFPROBE });
      const info = await p.inspeccionar(`${base}/entrada.mp4`, 'video');
      expect(info).toMatchObject({ ancho: 1920, alto: 1080 });
      expect(info.duracionSeg).toBeGreaterThan(2.5);
      const plan = planificarProcesamiento('video', info.ancho, info.alto);
      const salida = await p.procesar({ origen: `${base}/entrada.mp4`, tipo: 'video', plan, destinoTemporal: `${base}/tmp` });
      expect(salida.map((v) => `${v.clase}${String(v.lado)}.${v.formato}`).sort()).toEqual(['poster1280.webp', 'video1080.mp4', 'video720.mp4']);
      for (const v of salida.filter((x) => x.clase === 'video')) {
        const [bytes] = await h.bucket.file(v.rutaTemporal).download();
        const local = join(dir, `${String(v.lado)}.mp4`);
        writeFileSync(local, bytes);
        const sondeo = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', local], { encoding: 'utf8' })) as { streams: { height?: number; codec_name: string }[]; format: { tags?: Record<string, string> } };
        expect(sondeo.streams.find((s) => s.codec_name === 'h264')?.height).toBe(v.lado);
        expect(JSON.stringify(sondeo.format.tags ?? {})).not.toContain('DATO-PRIVADO');
        expect(bytes.includes(Buffer.from('DATO-PRIVADO'))).toBe(false);
      }
      const poster = salida.find((v) => v.clase === 'poster');
      const [pb] = await h.bucket.file(poster?.rutaTemporal ?? '').download();
      expect(await sharp(pb).metadata()).toMatchObject({ format: 'webp', width: 1280 });
      // Video y póster llegan al bucket público (y no al por defecto) con su tipo y caché inmutable.
      const almacen = crearAlmacenMedios(h.bucket, h.bucketPublico);
      const t = unico('vid').toLowerCase();
      for (const v of salida) {
        const destino = `tenants/${t}/publico/medios/cam-1/${'a'.repeat(32)}-${v.clase}${String(v.lado)}.${v.formato}`;
        await almacen.publicar(v.rutaTemporal, destino);
        const [m] = await h.bucketPublico.file(destino).getMetadata();
        expect(m.contentType).toBe(v.formato === 'mp4' ? 'video/mp4' : 'image/webp');
        expect(m.cacheControl).toBe('public, max-age=31536000, immutable');
        expect((await h.bucket.file(destino).exists())[0]).toBe(false);
        await almacen.borrar([destino]);
      }
      // La fábrica elige este procesador cuando el entorno trae los binarios.
      const completo = crearProcesadorMedios(h.bucket, { FFMPEG_PATH: FFMPEG, FFPROBE_PATH: FFPROBE });
      expect((await completo.inspeccionar(`${base}/entrada.mp4`, 'video')).ancho).toBe(1920);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  async function procesarClip(origen: string, nombre: string): Promise<{ readonly h: ReturnType<typeof herramientas>; readonly base: string; readonly salida: Awaited<ReturnType<ReturnType<typeof procesadorVideo>['procesar']>>; readonly info: { ancho: number; alto: number } }> {
    const h = herramientas();
    const base = `pruebas/${unico('vid')}`;
    await h.bucket.file(`${base}/${nombre}`).save(readFileSync(origen), { resumable: false });
    const p = procesadorVideo(h.bucket, { ffmpeg: FFMPEG, ffprobe: FFPROBE });
    const info = await p.inspeccionar(`${base}/${nombre}`, 'video');
    const plan = planificarProcesamiento('video', info.ancho, info.alto);
    const salida = await p.procesar({ origen: `${base}/${nombre}`, tipo: 'video', plan, destinoTemporal: `${base}/tmp` });
    return { h, base, salida, info };
  }

  async function verificarPublicacion(h: ReturnType<typeof herramientas>, salida: readonly { clase: string; lado: number; formato: string; rutaTemporal: string }[]): Promise<void> {
    const almacen = crearAlmacenMedios(h.bucket, h.bucketPublico);
    const t = unico('vid').toLowerCase();
    for (const v of salida) {
      const destino = `tenants/${t}/publico/medios/cam-1/${'b'.repeat(32)}-${v.clase}${String(v.lado)}.${v.formato}`;
      expect(RUTA_PUBLICA.test(destino)).toBe(true);
      await almacen.publicar(v.rutaTemporal, destino);
      expect((await h.bucketPublico.file(destino).exists())[0]).toBe(true);
      expect((await h.bucket.file(destino).exists())[0]).toBe(false);
      await almacen.borrar([destino]);
    }
  }

  it('un .webm (VP9 + Opus) se convierte a MP4 H.264 y llega con póster al bucket público', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'v-'));
    try {
      const origen = join(dir, 'entrada.webm');
      execFileSync(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=1280x720:rate=10', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libvpx-vp9', '-c:a', 'libopus', '-shortest', origen]);
      const { h, salida, info } = await procesarClip(origen, 'entrada.webm');
      expect(info).toMatchObject({ ancho: 1280, alto: 720 });
      expect(salida.some((v) => v.clase === 'video')).toBe(true);
      expect(salida.some((v) => v.clase === 'poster')).toBe(true);
      const v = salida.find((x) => x.clase === 'video');
      const [bytes] = await h.bucket.file(v?.rutaTemporal ?? '').download();
      const local = join(dir, 'salida.mp4');
      writeFileSync(local, bytes);
      const sondeo = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', local], { encoding: 'utf8' })) as { streams: { codec_name: string }[] };
      expect(sondeo.streams.map((s) => s.codec_name).sort()).toEqual(['aac', 'h264']);
      await verificarPublicacion(h, salida);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('un .mp4 con pista de subtítulos no la lleva a la salida', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'v-'));
    try {
      const srt = join(dir, 's.srt');
      writeFileSync(srt, '1\n00:00:00,000 --> 00:00:01,500\nSUBTITULO-PRIVADO\n');
      const origen = join(dir, 'entrada.mp4');
      execFileSync(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=640x360:rate=10', '-i', srt, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:s', 'mov_text', origen]);
      const entrada = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', origen], { encoding: 'utf8' })) as { streams: { codec_type: string }[] };
      expect(entrada.streams.some((s) => s.codec_type === 'subtitle')).toBe(true);
      const { h, salida } = await procesarClip(origen, 'entrada.mp4');
      const v = salida.find((x) => x.clase === 'video');
      const [bytes] = await h.bucket.file(v?.rutaTemporal ?? '').download();
      const local = join(dir, 'salida.mp4');
      writeFileSync(local, bytes);
      const sondeo = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', local], { encoding: 'utf8' })) as { streams: { codec_type: string }[] };
      expect(sondeo.streams.map((s) => s.codec_type)).toEqual(['video']);
      expect(bytes.includes(Buffer.from('SUBTITULO-PRIVADO'))).toBe(false);
      await verificarPublicacion(h, salida);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('un contenedor fuera de la lista se rechaza antes de procesarlo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'v-'));
    try {
      const origen = join(dir, 'entrada.avi');
      execFileSync(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=10', '-c:v', 'mpeg4', origen]);
      const h = herramientas();
      const base = `pruebas/${unico('vid')}`;
      await h.bucket.file(`${base}/entrada.avi`).save(readFileSync(origen), { resumable: false });
      const p = procesadorVideo(h.bucket, { ffmpeg: FFMPEG, ffprobe: FFPROBE });
      await expect(p.inspeccionar(`${base}/entrada.avi`, 'video')).rejects.toThrow('Formato de video no admitido: use MP4, MOV o WebM');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
