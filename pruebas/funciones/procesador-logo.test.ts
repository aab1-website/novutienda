// Procesamiento del logo con sharp sobre un bucket en memoria (sin emulador): PNG y WebP, lado mayor ≤ 512, sin ampliar, sin metadatos.
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { planificarProcesamiento } from '@novutienda/consola';
import { crearProcesadorMedios } from '../../plataforma/conectores/firebase/index.js';
import type { Bucket } from '../../plataforma/conectores/firebase/almacen-medios.js';

function bucketEnMemoria(): { readonly bucket: Bucket; readonly objetos: Map<string, { bytes: Buffer; contentType?: string }> } {
  const objetos = new Map<string, { bytes: Buffer; contentType?: string }>();
  const bucket = {
    file: (ruta: string) => ({
      getMetadata: () => Promise.resolve([{ size: String(objetos.get(ruta)?.bytes.length ?? 0) }]),
      download: () => Promise.resolve([objetos.get(ruta)?.bytes ?? Buffer.alloc(0)]),
      save: (bytes: Buffer, o: { contentType?: string }) => {
        objetos.set(ruta, { bytes, ...(o.contentType === undefined ? {} : { contentType: o.contentType }) });
        return Promise.resolve();
      },
    }),
  } as unknown as Bucket;
  return { bucket, objetos };
}

async function correr(original: Buffer, ancho: number, alto: number) {
  const { bucket, objetos } = bucketEnMemoria();
  objetos.set('origen', { bytes: original });
  const p = crearProcesadorMedios(bucket);
  const plan = planificarProcesamiento('logo', ancho, alto);
  const versiones = await p.procesar({ origen: 'origen', tipo: 'foto', plan, destinoTemporal: 'tmp' });
  return { versiones, objetos };
}

describe('procesador de logo', () => {
  it('inspecciona el logo como imagen (no como video)', async () => {
    const { bucket, objetos } = bucketEnMemoria();
    objetos.set('o', { bytes: await sharp({ create: { width: 40, height: 30, channels: 3, background: '#fff' } }).png().toBuffer() });
    const p = crearProcesadorMedios(bucket);
    expect(await p.disponible?.('foto')).toBe(true);
    expect(await p.inspeccionar('o', 'foto')).toEqual({ ancho: 40, alto: 30 });
  });

  it('reduce a 512 por el lado mayor, en PNG y WebP, sin EXIF', async () => {
    const original = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: { r: 10, g: 90, b: 200 } } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'DATO-PRIVADO-DEL-DUENO' } })
      .toBuffer();
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const { versiones, objetos } = await correr(original, 2000, 1000);
    expect(versiones.map((v) => `${v.clase}.${String(v.lado)}.${v.formato}`).sort()).toEqual(['logo.512.png', 'logo.512.webp']);
    for (const v of versiones) {
      const o = objetos.get(v.rutaTemporal);
      expect(o?.contentType).toBe(v.formato === 'png' ? 'image/png' : 'image/webp');
      const m = await sharp(o?.bytes).metadata();
      expect(m.format).toBe(v.formato);
      expect([m.width, m.height]).toEqual([512, 256]);
      expect(m.exif).toBeUndefined();
      expect(o?.bytes.includes(Buffer.from('DATO-PRIVADO-DEL-DUENO'))).toBe(false);
    }
  });

  it('no amplía un logo más chico que 512', async () => {
    const original = await sharp({ create: { width: 100, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();
    const { versiones, objetos } = await correr(original, 100, 200);
    expect(versiones.map((v) => v.lado)).toEqual([200, 200]);
    for (const v of versiones) {
      const m = await sharp(objetos.get(v.rutaTemporal)?.bytes).metadata();
      expect([m.width, m.height]).toEqual([100, 200]);
    }
  });
});
