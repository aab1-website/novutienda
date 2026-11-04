// Subida de medios de punta a punta en el emulador: reserva (callable) → objeto en la ruta privada → disparador
// de Storage → versiones públicas con hash y caché inmutable, sin EXIF/GPS → borrado. Más los rechazos.
import sharp from 'sharp';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { accion, crearUsuario, esperar, hayEmulador, herramientas, sembrarTenant, unico, type Herramientas, type Usuario } from './ayudas.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const M = 'medios-a';
const PRODUCTO = 'camara-web';

describe.skipIf(!hayEmulador)('medios (emulador)', () => {
  let h: Herramientas;
  let sup: Usuario;
  let caj: Usuario;

  beforeAll(async () => {
    h = herramientas();
    await sembrarTenant(h, M, { productos: [{ id: PRODUCTO, nombre: 'Cámara web', precioUSD: { bo: 5000, ar: 5000 }, tienda: 0 }] });
    sup = await crearUsuario(h, { rol: 'sup', tenant: M });
    caj = await crearUsuario(h, { rol: 'caj', tenant: M });
  });

  const rutaOriginal = (sub: string): string => `tenants/${M}/privado/originales/${PRODUCTO}/${sub}`;
  const idSubida = (): string => unico('sub').slice(0, 38);

  async function fotoConGps(ancho = 3000, alto = 2000): Promise<Buffer> {
    return sharp({ create: { width: ancho, height: alto, channels: 3, background: { r: 200, g: 30, b: 30 } } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'DATO-PRIVADO-DEL-DUENO', ImageDescription: 'calle falsa 123' } })
      .toBuffer();
  }

  it('solo sup/adm reservan; el vendedor no', async () => {
    const r = await accion('medios', 'reservarSubida', { subidaId: idSubida(), productoId: PRODUCTO, tipo: 'foto', bytes: 1000 }, caj.token, M);
    expect(r.status).toBe(403);
  });

  it('procesa la foto al subirla: 4 anchos en AVIF y WebP, sin metadatos, con caché inmutable', async () => {
    const original = await fotoConGps();
    expect((await sharp(original).metadata()).exif).toBeDefined(); // el original sí trae EXIF
    const id = idSubida();
    const reserva = await accion('medios', 'reservarSubida', { subidaId: id, productoId: PRODUCTO, tipo: 'foto', bytes: original.length }, sup.token, M);
    expect(reserva.status, JSON.stringify(reserva.error)).toBe(200);
    expect((reserva.resultado as { rutaOriginal: string }).rutaOriginal).toBe(rutaOriginal(id));

    await h.bucket.file(rutaOriginal(id)).save(original, { contentType: 'image/jpeg', resumable: false });

    // El disparador de Storage finaliza la subida; el estado queda en Firestore.
    const medio = await esperar(async () => (await h.firestore.doc(`tenants/${M}/medios/${id}`).get()).data(), 90_000, 'el medio procesado por el disparador');
    expect(medio).toMatchObject({ productoId: PRODUCTO, tipo: 'foto', ancho: 3000, alto: 2000 });
    const versiones = medio['versiones'] as { clase: string; lado: number; formato: string; ruta: string }[];
    expect(versiones.map((v) => `${String(v.lado)}.${v.formato}`).sort()).toEqual(
      ['1600.avif', '1600.webp', '2400.avif', '2400.webp', '480.avif', '480.webp', '960.avif', '960.webp'],
    );
    for (const v of versiones) {
      expect(v.ruta).toMatch(new RegExp(`^tenants/${M}/publico/medios/${PRODUCTO}/[0-9a-f]{32}-imagen${String(v.lado)}\\.${v.formato}$`));
      const archivo = h.bucket.file(v.ruta);
      const [meta] = await archivo.getMetadata();
      expect(meta.cacheControl).toBe('public, max-age=31536000, immutable');
      expect(meta.contentType).toBe(v.formato === 'avif' ? 'image/avif' : 'image/webp');
      const [bytes] = await archivo.download();
      const m = await sharp(bytes).metadata();
      expect(m.exif, `EXIF en ${v.ruta}`).toBeUndefined();
      expect(m.width).toBe(v.lado);
      expect(bytes.includes(Buffer.from('DATO-PRIVADO-DEL-DUENO'))).toBe(false);
    }
    const sub = (await h.firestore.doc(`tenants/${M}/subidas/${id}`).get()).data();
    expect(sub?.['estado']).toBe('procesada');
    // Los temporales se borran.
    const [temporales] = await h.bucket.getFiles({ prefix: `tenants/${M}/privado/procesando/${id}/` });
    expect(temporales).toHaveLength(0);

    // finalizarSubida explícito es idempotente: devuelve el mismo medio.
    const otra = await accion('medios', 'finalizarSubida', { subidaId: id }, sup.token, M);
    expect(otra.status).toBe(200);
    expect((otra.resultado as { medio: { id: string } }).medio.id).toBe(id);

    // Borrar: libera cuota y borra original y versiones.
    const borrado = await accion('medios', 'borrarMedio', { medioId: id }, sup.token, M);
    expect(borrado.status, JSON.stringify(borrado.error)).toBe(200);
    expect((await h.firestore.doc(`tenants/${M}/medios/${id}`).get()).exists).toBe(false);
    expect((await h.bucket.file(rutaOriginal(id)).exists())[0]).toBe(false);
    expect((await h.bucket.file(versiones[0]?.ruta ?? '').exists())[0]).toBe(false);
    expect((await h.firestore.doc(`tenants/${M}/uso/medios`).get()).data()).toMatchObject({ bytes: 0 });
  });

  it('una foto más chica que el plan solo genera los anchos que caben', async () => {
    const original = await fotoConGps(700, 500);
    const id = idSubida();
    await accion('medios', 'reservarSubida', { subidaId: id, productoId: PRODUCTO, tipo: 'foto', bytes: original.length }, sup.token, M);
    await h.bucket.file(rutaOriginal(id)).save(original, { contentType: 'image/jpeg', resumable: false });
    const medio = await esperar(async () => (await h.firestore.doc(`tenants/${M}/medios/${id}`).get()).data(), 90_000, 'medio chico');
    expect((medio['versiones'] as { lado: number }[]).map((v) => v.lado).sort((a, b) => a - b)).toEqual([480, 480]);
  });

  const usoBytes = async (): Promise<number> => ((await h.firestore.doc(`tenants/${M}/uso/medios`).get()).data()?.['bytes'] as number | undefined) ?? 0;

  it('rechaza un archivo que dice ser foto pero no lo es: libera la reserva y borra el original', async () => {
    const id = idSubida();
    const antes = await usoBytes();
    const falso = Buffer.from('esto no es una imagen, es texto plano con extensión .jpg');
    await accion('medios', 'reservarSubida', { subidaId: id, productoId: PRODUCTO, tipo: 'foto', bytes: falso.length }, sup.token, M);
    await h.bucket.file(rutaOriginal(id)).save(falso, { contentType: 'image/jpeg', resumable: false });
    await esperar(async () => (await h.firestore.doc(`tenants/${M}/subidas/${id}`).get()).data()?.['estado'] === 'rechazada', 60_000, 'subida rechazada');
    expect((await h.bucket.file(rutaOriginal(id)).exists())[0]).toBe(false);
    expect((await h.firestore.doc(`tenants/${M}/medios/${id}`).get()).exists).toBe(false);
    expect(await usoBytes()).toBe(antes);
  });

  it('el video se rechaza con claridad si el entorno no trae ffmpeg, sin publicar nada', async () => {
    const id = idSubida();
    // Cabecera MP4 mínima (caja ftyp con la marca isom): pasa la detección de tipo y llega al procesador.
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), Buffer.alloc(4), Buffer.from('isomiso2avc1mp41')]);
    await accion('medios', 'reservarSubida', { subidaId: id, productoId: PRODUCTO, tipo: 'video', bytes: mp4.length }, sup.token, M);
    await h.bucket.file(rutaOriginal(id)).save(mp4, { contentType: 'video/mp4', resumable: false });
    await esperar(async () => (await h.firestore.doc(`tenants/${M}/subidas/${id}`).get()).data()?.['estado'] === 'rechazada', 60_000, 'video rechazado');
    const [publicos] = await h.bucket.getFiles({ prefix: `tenants/${M}/publico/medios/${PRODUCTO}/` });
    expect(publicos.filter((f) => f.name.endsWith('.mp4'))).toHaveLength(0);
  });
});
