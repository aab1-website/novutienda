// Adaptadores reales contra Firestore y Storage del emulador (en proceso, sin pasar por las funciones).
import { createHash, randomBytes } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { Timestamp } from 'firebase-admin/firestore';
import sharp from 'sharp';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { crearAlmacenMedios, crearConsultaSubidas, crearEjecutorRecibos, crearGuardarContacto, crearLectorDisponibilidad, crearLimiteTasa, crearProcesadorMedios, hashClave, procesadorImagenes } from '../../plataforma/conectores/firebase/index.js';
import { planificarProcesamiento } from '@novutienda/consola';
import { hayEmulador, herramientas, sembrarTenant, unico, type Herramientas } from './ayudas.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

describe.skipIf(!hayEmulador)('adaptadores de Firestore (emulador)', () => {
  let h: Herramientas;
  beforeAll(() => {
    h = herramientas();
  });

  it('transacción: create falla si existe, nuevoId y marca de tiempo del servidor', async () => {
    const ruta = `pruebas/${unico('doc')}/items/a`;
    await h.db.runTransaction(async (tx) => {
      tx.create(ruta, { n: 1, en: tx.marcaTiempoServidor(), omitido: undefined });
    });
    const d = (await h.firestore.doc(ruta).get()).data();
    expect(d?.['n']).toBe(1);
    expect(d?.['en']).toBeInstanceOf(Timestamp);
    expect(d).not.toHaveProperty('omitido');
    await expect(h.db.runTransaction(async (tx) => { tx.create(ruta, { n: 2 }); })).rejects.toThrow();
    await h.db.runTransaction(async (tx) => {
      expect(tx.nuevoId('pruebas/x/items')).toMatch(/^[A-Za-z0-9]{20}$/);
    });
  });

  it('transacción: las lecturas van antes de las escrituras (el SDK lo exige)', async () => {
    const ruta = `pruebas/${unico('orden')}/items/a`;
    await expect(
      h.db.runTransaction(async (tx) => {
        tx.set(ruta, { n: 1 });
        await tx.get(ruta);
      }),
    ).rejects.toThrow(/reads to be executed before all writes/i);
  });

  it('transacción: es serializable bajo concurrencia (20 incrementos simultáneos, ninguno se pierde)', async () => {
    const ruta = `pruebas/${unico('cont')}/items/c`;
    await h.firestore.doc(ruta).set({ n: 0 });
    await Promise.all(
      Array.from({ length: 20 }, () =>
        h.db.runTransaction(async (tx) => {
          const n = ((await tx.get(ruta)).data()?.['n'] as number) ?? 0;
          tx.set(ruta, { n: n + 1 });
        }),
      ),
    );
    expect((await h.firestore.doc(ruta).get()).data()?.['n']).toBe(20);
  });

  it('listar devuelve los documentos de la colección', async () => {
    const col = `pruebas/${unico('lista')}/items`;
    await h.firestore.doc(`${col}/a`).set({ x: 1 });
    await h.firestore.doc(`${col}/b`).set({ x: 2 });
    const l = await h.db.listar(col);
    expect(l.map((d) => d.id).sort()).toEqual(['a', 'b']);
  });

  it('ejecutor de Recibos: actualizar modifica campos de un documento existente y falla si no existe', async () => {
    const e = crearEjecutorRecibos(h.firestore);
    const ruta = `pruebas/${unico('rec')}/recibos/r1`;
    await e.transaccion(async (tx) => {
      tx.create(ruta, { a: 1, b: 2 });
    });
    await e.transaccion(async (tx) => {
      tx.actualizar(ruta, { b: 3, c: undefined });
    });
    expect((await h.firestore.doc(ruta).get()).data()).toEqual({ a: 1, b: 3 });
    await expect(e.transaccion(async (tx) => { tx.actualizar(`${ruta}-no-existe`, { b: 1 }); })).rejects.toThrow();
    expect(await e.transaccion((tx) => tx.leer(`${ruta}-no-existe`))).toBeUndefined();
  });

  it('límite de tasa: ventana fija, hash salado de la clave y reinicio al vencer la ventana', async () => {
    const limite = crearLimiteTasa(h.firestore, { maximo: 2, ventanaMs: 10_000, sal: 'sal-de-prueba' });
    const clave = `contacto:198.51.100.${String(Math.floor(Math.random() * 250))}-${unico('k')}`;
    const t0 = 1_000_000;
    expect(await limite.intentar(clave, t0)).toEqual({ permitido: true, reintentarEnSeg: 0 });
    expect(await limite.intentar(clave, t0 + 1000)).toEqual({ permitido: true, reintentarEnSeg: 0 });
    const tercero = await limite.intentar(clave, t0 + 2000);
    expect(tercero).toEqual({ permitido: false, reintentarEnSeg: 8 });
    expect((await h.firestore.doc(`limitesTasa/${hashClave(clave, 'sal-de-prueba')}`).get()).exists).toBe(true);
    expect(hashClave(clave, 'sal-de-prueba')).not.toBe(hashClave(clave, 'otra-sal'));
    expect(await limite.intentar(clave, t0 + 10_001)).toEqual({ permitido: true, reintentarEnSeg: 0 });
    expect(() => crearLimiteTasa(h.firestore, { maximo: 0, ventanaMs: 10_000, sal: 's' })).toThrow(RangeError);
  });

  it('contacto: crea una sola vez por operacionId', async () => {
    const t = unico('contacto-t');
    const g = crearGuardarContacto(h.firestore, t);
    const c = { operacionId: unico('op'), nombre: 'Ana', correo: null, telefono: '70012345', mensaje: 'Hola', pais: null, productoId: null } as const;
    expect(await g.guardar(c, 123)).toBe('creado');
    expect(await g.guardar(c, 456)).toBe('repetido');
    expect((await h.firestore.doc(`tenants/${t}/contactos/${c.operacionId}`).get()).data()?.['recibidoEnMs']).toBe(123);
  });

  it('disponibilidad: lee solo el booleano y omite lo desconocido', async () => {
    const t = unico('disp-t');
    await h.firestore.doc(`tenants/${t}/existenciasPublicas/p-uno`).set({ productoId: 'p-uno', disponible: true, cantidad: 99 });
    await h.firestore.doc(`tenants/${t}/existenciasPublicas/p-dos`).set({ productoId: 'p-dos', disponible: false });
    const leer = crearLectorDisponibilidad(h.firestore, t);
    expect(await leer(['p-uno', 'p-dos', 'p-tres'])).toEqual({ 'p-uno': true, 'p-dos': false });
    expect(await leer([])).toEqual({});
  });

  it('consulta de subidas: por estado, las más viejas primero y acotadas', async () => {
    const t = unico('sub-t');
    await h.firestore.doc(`tenants/${t}/subidas/b`).set({ estado: 'reservada', venceEn: 20 });
    await h.firestore.doc(`tenants/${t}/subidas/a`).set({ estado: 'reservada', venceEn: 10 });
    await h.firestore.doc(`tenants/${t}/subidas/c`).set({ estado: 'borrando', venceEn: 5 });
    const q = crearConsultaSubidas(h.firestore);
    expect((await q.listarPorEstado(t, 'reservada', 10)).map((s) => s.id)).toEqual(['a', 'b']);
    expect((await q.listarPorEstado(t, 'reservada', 1)).map((s) => s.id)).toEqual(['a']);
    expect((await q.listarPorEstado(t, 'borrando', 10)).map((s) => s.id)).toEqual(['c']);
  });

  it('sembrado de tenant con las funciones reales de los módulos', async () => {
    const t = unico('semb').toLowerCase();
    await sembrarTenant(h, t, { productos: [{ id: 'lapiz', nombre: 'Lápiz', precioUSD: { bo: 100, ar: 100 }, tienda: 4 }] });
    expect((await h.firestore.doc(`tenants/${t}/existencias/lapiz__tienda`).get()).data()?.['cantidad']).toBe(4);
    expect((await h.firestore.doc(`tenants/${t}/existenciasPublicas/lapiz`).get()).data()?.['disponible']).toBe(true);
  });
});

describe.skipIf(!hayEmulador)('almacén de medios y procesador (emulador de Storage)', () => {
  let h: Herramientas;
  beforeAll(() => {
    h = herramientas();
  });

  it('tamaño, inicio, hash SHA-256, publicación con caché inmutable y borrado tolerante', async () => {
    const almacen = crearAlmacenMedios(h.bucket);
    const base = `pruebas/${unico('alm')}`;
    const contenido = randomBytes(5000);
    await h.bucket.file(`${base}/a.webp`).save(contenido, { contentType: 'application/octet-stream', resumable: false });
    expect(await almacen.tamano(`${base}/a.webp`)).toBe(5000);
    expect(await almacen.tamano(`${base}/no-existe`)).toBeUndefined();
    expect(Buffer.from(await almacen.leerInicio(`${base}/a.webp`, 16))).toEqual(contenido.subarray(0, 16));
    expect(await almacen.hashContenido(`${base}/a.webp`)).toBe(createHash('sha256').update(contenido).digest('hex'));
    await almacen.publicar(`${base}/a.webp`, `${base}/pub/x.webp`);
    const [meta] = await h.bucket.file(`${base}/pub/x.webp`).getMetadata();
    expect(meta.cacheControl).toBe('public, max-age=31536000, immutable');
    expect(meta.contentType).toBe('image/webp');
    await almacen.borrar([`${base}/a.webp`, `${base}/pub/x.webp`, `${base}/no-existe`]);
    expect(await almacen.tamano(`${base}/a.webp`)).toBeUndefined();
    await expect(almacen.leerInicio(`${base}/a.webp`, 0)).rejects.toThrow(RangeError);
  });

  it('procesador de imágenes: orientación aplicada, sin EXIF, anchos del plan y tope de píxeles', async () => {
    const base = `pruebas/${unico('img')}`;
    // 600 × 400 con orientación EXIF 6 (girada 90°): las dimensiones útiles son 400 × 600.
    const girada = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#336699' } }).jpeg().withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'PRIVADO' } } }).toBuffer();
    await h.bucket.file(`${base}/o.jpg`).save(girada, { contentType: 'image/jpeg', resumable: false });
    const p = procesadorImagenes(h.bucket);
    expect(await p.inspeccionar(`${base}/o.jpg`, 'foto')).toEqual({ ancho: 400, alto: 600 });
    const plan = planificarProcesamiento('foto', 400, 600);
    const salida = await p.procesar({ origen: `${base}/o.jpg`, tipo: 'foto', plan, destinoTemporal: `${base}/tmp` });
    expect(salida).toHaveLength(plan.items.length);
    for (const v of salida) {
      const [bytes] = await h.bucket.file(v.rutaTemporal).download();
      const m = await sharp(bytes).metadata();
      expect(m.exif).toBeUndefined();
      expect(m.width).toBeLessThanOrEqual(400);
      expect(m.orientation ?? 1).toBe(1);
    }
    // Una imagen que declara un tamaño absurdo (cabecera PNG de 20 000 × 20 000) se rechaza antes de decodificarla.
    const chunk = (tipo: string, datos: Buffer): Buffer => {
      const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
      const len = Buffer.alloc(4);
      len.writeUInt32BE(datos.length);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(cuerpo));
      return Buffer.concat([len, cuerpo, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(20_000, 0);
    ihdr.writeUInt32BE(20_000, 4);
    ihdr.set([8, 2, 0, 0, 0], 8);
    const bomba = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', Buffer.from([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01])), chunk('IEND', Buffer.alloc(0))]);
    await h.bucket.file(`${base}/bomba.png`).save(bomba, { contentType: 'image/png', resumable: false });
    await expect(p.inspeccionar(`${base}/bomba.png`, 'foto')).rejects.toThrow(/pixel/i);
  });

  it('procesador de medios: sin binarios el video no está disponible (error claro, no simulado)', async () => {
    const p = crearProcesadorMedios(h.bucket, {});
    await expect(p.inspeccionar('x', 'video')).rejects.toThrow(/video no está disponible/i);
    await expect(p.procesar({ origen: 'x', tipo: 'video', plan: planificarProcesamiento('video', 1280, 720), destinoTemporal: 'pruebas/t' })).rejects.toThrow(/video no está disponible/i);
  });
});
