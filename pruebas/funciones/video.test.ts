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
import { binariosDeVideo, crearProcesadorMedios, procesadorVideo } from '../../plataforma/conectores/firebase/index.js';
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

describe('binarios de video', () => {
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
      // La fábrica elige este procesador cuando el entorno trae los binarios.
      const completo = crearProcesadorMedios(h.bucket, { FFMPEG_PATH: FFMPEG, FFPROBE_PATH: FFPROBE });
      expect((await completo.inspeccionar(`${base}/entrada.mp4`, 'video')).ancho).toBe(1920);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
