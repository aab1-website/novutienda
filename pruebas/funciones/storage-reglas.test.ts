// Reglas de Cloud Storage contra el emulador (con la reserva leída de Firestore entre servicios).
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, it, vi } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';
import { hayEmuladorStorage, PROYECTO } from './ayudas.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const [hostFs = '127.0.0.1', puertoFs = '8241'] = (process.env['FIRESTORE_EMULATOR_HOST'] ?? '127.0.0.1:8241').split(':');
const [hostSt = '127.0.0.1', puertoSt = '8243'] = (process.env['FIREBASE_STORAGE_EMULATOR_HOST'] ?? '127.0.0.1:8243').split(':');

const MIB = 1024 * 1024;
const T = 'tienda-uno';
const OTRO = 'tienda-dos';
const PRODUCTO = 'lapiz-hb';
const bytes = (n: number): Uint8Array => new Uint8Array(n).fill(0xff);
const original = (sub: string, producto = PRODUCTO, t = T): string => `tenants/${t}/privado/originales/${producto}/${sub}`;

const pl = (rol: string, t = T): Record<string, unknown> => ({ pl: { t: { [t]: rol }, v: 1 } });
const sesion = (rol: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  email_verified: true, firebase: { sign_in_provider: 'password' }, ...pl(rol), ...extra,
});

describe.skipIf(!hayEmuladorStorage)('reglas de Storage (emulador)', () => {
  let env: RulesTestEnvironment;

  async function reservar(id: string, o: { tipo?: 'foto' | 'video'; bytes?: number; por?: string; estado?: string; producto?: string; venceEn?: number | null } = {}): Promise<void> {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`tenants/${T}/subidas/${id}`).set({
        id, productoId: o.producto ?? PRODUCTO, tipo: o.tipo ?? 'foto', bytes: o.bytes ?? 15 * MIB, estado: o.estado ?? 'reservada', por: o.por ?? 'u-sup',
        // `venceEn` en milisegundos, como lo escribe la consola; por defecto vigente una hora.
        ...(o.venceEn === null ? {} : { venceEn: o.venceEn ?? Date.now() + 3_600_000 }),
      });
    });
  }

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: PROYECTO,
      firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: hostFs, port: Number(puertoFs) },
      storage: { rules: readFileSync('storage.rules', 'utf8'), host: hostSt, port: Number(puertoSt) },
    });
  });
  afterAll(async () => {
    await env.cleanup();
  });

  const subir = (ctx: ReturnType<RulesTestEnvironment['authenticatedContext']>, ruta: string, n: number, contentType = 'image/jpeg') =>
    uploadBytes(ref(ctx.storage(), ruta), bytes(n), { contentType });

  describe('subida de originales', () => {
    it('permite a sup y adm del tenant con reserva vigente, tamaño y tipo correctos', async () => {
      await reservar('subida-001', { por: 'u-sup' });
      await assertSucceeds(subir(env.authenticatedContext('u-sup', sesion('sup')), original('subida-001'), 1024));
      await reservar('subida-002', { por: 'u-adm' });
      await assertSucceeds(subir(env.authenticatedContext('u-adm', sesion('adm')), original('subida-002'), 1024, 'image/png'));
      await reservar('subida-003', { por: 'u-sup', tipo: 'video', bytes: 20 * MIB });
      await assertSucceeds(subir(env.authenticatedContext('u-sup', sesion('sup')), original('subida-003'), MIB, 'video/mp4'));
    });

    it('niega al vendedor, a un rol de otro tenant, al correo sin verificar y al anónimo', async () => {
      await reservar('subida-010', { por: 'u-caj' });
      await assertFails(subir(env.authenticatedContext('u-caj', sesion('caj')), original('subida-010'), 1024));
      await reservar('subida-011', { por: 'u-otro' });
      await assertFails(subir(env.authenticatedContext('u-otro', { ...sesion('adm'), ...pl('adm', OTRO) }), original('subida-011'), 1024));
      await reservar('subida-012', { por: 'u-sup' });
      await assertFails(subir(env.authenticatedContext('u-sup', sesion('sup', { email_verified: false })), original('subida-012'), 1024));
      await assertFails(subir(env.authenticatedContext('u-sup', sesion('sup', { firebase: { sign_in_provider: 'anonymous' } })), original('subida-012'), 1024));
      await assertFails(subir(env.unauthenticatedContext(), original('subida-012'), 1024));
      await assertFails(subir(env.authenticatedContext('u-sup', sesion('sup', { firebase: { sign_in_provider: 'google.com' } })), original('subida-012'), 1024));
    });

    it('exige que exista la reserva, que sea del mismo producto, de la misma persona y que siga «reservada»', async () => {
      const sup = env.authenticatedContext('u-sup', sesion('sup'));
      await assertFails(subir(sup, original('subida-sin-reserva'), 1024));
      await reservar('subida-020', { producto: 'otro-producto' });
      await assertFails(subir(sup, original('subida-020'), 1024));
      await reservar('subida-021', { por: 'otra-persona' });
      await assertFails(subir(sup, original('subida-021'), 1024));
      await reservar('subida-022', { estado: 'procesada' });
      await assertFails(subir(sup, original('subida-022'), 1024));
      // Reserva vencida (`venceEn` en el pasado) o sin `venceEn`: se niega aunque lo demás sea correcto.
      await reservar('subida-023', { venceEn: Date.now() - 1000 });
      await assertFails(subir(sup, original('subida-023'), 1024));
      await reservar('subida-024', { venceEn: null });
      await assertFails(subir(sup, original('subida-024'), 1024));
    });

    it('respeta el tamaño (15 MB foto, 200 MB video, y no más que lo reservado) y el tipo', async () => {
      const sup = env.authenticatedContext('u-sup', sesion('sup'));
      await reservar('subida-030', { bytes: 100 * MIB });
      await assertFails(subir(sup, original('subida-030'), 15 * MIB + 1));
      await reservar('subida-031', { bytes: 1024 });
      await assertFails(subir(sup, original('subida-031'), 2048));
      await assertFails(subir(sup, original('subida-031'), 0));
      // El tope de 200 MB del video no se prueba subiendo 200 MB: el cuerpo de la petición lo limita el propio
      // emulador. Se prueba que un video no supere lo reservado y que la reserva misma no pase de 200 MB en la consola.
      await reservar('subida-032', { tipo: 'video', bytes: 2 * MIB });
      await assertFails(subir(sup, original('subida-032'), 3 * MIB, 'video/mp4'));
      await reservar('subida-033', {});
      await assertFails(subir(sup, original('subida-033'), 1024, 'application/pdf'));
      await assertFails(subir(sup, original('subida-033'), 1024, 'video/mp4'));
      await reservar('subida-034', { tipo: 'video', bytes: MIB });
      await assertFails(subir(sup, original('subida-034'), 1024, 'image/jpeg'));
    });

    it('solo crea: no reemplaza ni borra ni lee un original desde el navegador', async () => {
      await reservar('subida-040', {});
      const sup = env.authenticatedContext('u-sup', sesion('sup'));
      await assertSucceeds(subir(sup, original('subida-040'), 1024));
      await reservar('subida-040', {}); // la reserva sigue vigente, pero el objeto ya existe
      await assertFails(subir(sup, original('subida-040'), 2048));
      await assertFails(deleteObject(ref(sup.storage(), original('subida-040'))));
      await assertFails(getBytes(ref(env.authenticatedContext('u-adm', sesion('adm')).storage(), original('subida-040'))));
    });
  });

  describe('lectura pública y resto denegado', () => {
    it('lee `publico/**` sin sesión pero no lo escribe', async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await uploadBytes(ref(ctx.storage(), `tenants/${T}/publico/medios/${PRODUCTO}/abc-imagen480.webp`), bytes(10), { contentType: 'image/webp' });
      });
      const anonimo = env.unauthenticatedContext();
      await assertSucceeds(getBytes(ref(anonimo.storage(), `tenants/${T}/publico/medios/${PRODUCTO}/abc-imagen480.webp`)));
      const adm = env.authenticatedContext('u-adm', sesion('adm'));
      await assertFails(subir(adm, `tenants/${T}/publico/medios/${PRODUCTO}/otro.webp`, 10, 'image/webp'));
      await assertFails(deleteObject(ref(adm.storage(), `tenants/${T}/publico/medios/${PRODUCTO}/abc-imagen480.webp`)));
    });

    it('niega lo privado (temporales, recibos), rutas de otro tenant y cualquier otra ruta', async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await uploadBytes(ref(ctx.storage(), `tenants/${T}/privado/recibos/r.pdf`), bytes(10), { contentType: 'application/pdf' });
      });
      const adm = env.authenticatedContext('u-adm', sesion('adm'));
      await assertFails(getBytes(ref(adm.storage(), `tenants/${T}/privado/recibos/r.pdf`)));
      await assertFails(subir(adm, `tenants/${T}/privado/procesando/x/imagen480.webp`, 10, 'image/webp'));
      await assertFails(subir(adm, 'cualquier/ruta.jpg', 10));
      await assertFails(getBytes(ref(adm.storage(), 'cualquier/ruta.jpg')));
    });
  });
});
