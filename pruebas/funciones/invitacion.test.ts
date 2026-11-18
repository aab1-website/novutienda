// Invitación de personas con rol reservado, de punta a punta contra los emuladores (Auth, Firestore y Functions): callables
// `consola` (invitarUsuario, anularInvitacion, reenviarInvitacion) y `activarInvitaciones`. Corre en `pnpm test:funciones`.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { crearIndiceInvitaciones } from '../../plataforma/conectores/firebase/index.js';
import { accion, crearUsuario, hayEmulador, herramientas, iniciarSesion, llamar, sembrarTenant, unico, type Herramientas } from './ayudas.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const CLAVE = 'contraseña-de-prueba-123';
const correoNuevo = (): string => `${unico('inv')}@prueba.test`;

describe.skipIf(!hayEmulador)('invitaciones (emuladores)', () => {
  let h: Herramientas;
  beforeAll(() => {
    h = herramientas();
  });

  const comercio = async (): Promise<string> => {
    const t = unico('inv-t');
    await sembrarTenant(h, t);
    return t;
  };
  const invitar = (token: string, t: string, correo: string, rol = 'caj') => accion('consola', 'invitarUsuario', { correo, rol }, token, t);
  const miembro = async (t: string, uid: string) => (await h.firestore.doc(`tenants/${t}/miembros/${uid}`).get()).data();
  const uidDe = async (correo: string): Promise<string> => (await h.auth.getUserByEmail(correo)).uid;

  it('adm invita, la persona fija su clave y activa: el rol queda en el claim', async () => {
    const t = await comercio();
    const adm = await crearUsuario(h, { rol: 'adm', tenant: t });
    const correo = correoNuevo();
    const r = await invitar(adm.token, t, correo, 'sup');
    expect(r.status).toBe(200);
    expect(r.resultado).toMatchObject({ ok: true, mensaje: 'Invitación enviada' });
    const uid = await uidDe(correo);
    expect((await miembro(t, uid))?.['estado']).toBe('invitado');
    // El enlace del correo fija la clave y verifica el correo; aquí se simula con Admin.
    await h.auth.updateUser(uid, { password: CLAVE, emailVerified: true });
    const token = await iniciarSesion(correo);
    const a = await llamar('activarInvitaciones', {}, token);
    expect(a.status).toBe(200);
    expect(a.resultado).toMatchObject({ activadas: 1 });
    const claims = (await h.auth.getUser(uid)).customClaims as { pl?: { t?: Record<string, string> } };
    expect(claims.pl?.t?.[t]).toBe('sup');
    expect((await miembro(t, uid))?.['rol']).toBe('sup');
  });

  it('el administrador también puede invitar a otro administrador', async () => {
    const t = await comercio();
    const adm = await crearUsuario(h, { rol: 'adm', tenant: t });
    expect((await invitar(adm.token, t, correoNuevo(), 'adm')).status).toBe(200);
  });

  it.each(['sup', 'caj'] as const)('%s no puede invitar', async (rol) => {
    const t = await comercio();
    const u = await crearUsuario(h, { rol, tenant: t });
    const correo = correoNuevo();
    const r = await invitar(u.token, t, correo);
    expect(r.status).toBe(403);
    await expect(h.auth.getUserByEmail(correo)).rejects.toMatchObject({ code: 'auth/user-not-found' });
  });

  it('cupo lleno del plan: la invitación se rechaza y no deja cuenta huérfana', async () => {
    const t = await comercio();
    const adm = await crearUsuario(h, { rol: 'adm', tenant: t });
    let rechazo: Awaited<ReturnType<typeof invitar>> | undefined;
    let correoRechazado = '';
    for (let i = 0; i < 4 && rechazo === undefined; i += 1) {
      const correo = correoNuevo();
      const r = await invitar(adm.token, t, correo);
      if (r.status !== 200) {
        rechazo = r;
        correoRechazado = correo;
      }
    }
    expect(rechazo?.error?.status).toBe('RESOURCE_EXHAUSTED');
    await expect(h.auth.getUserByEmail(correoRechazado)).rejects.toMatchObject({ code: 'auth/user-not-found' });
  });

  it('más de 5 invitaciones por hora en un comercio: límite', async () => {
    const t = await comercio();
    const adm = await crearUsuario(h, { rol: 'adm', tenant: t });
    const estados: (string | undefined)[] = [];
    for (let i = 0; i < 7; i += 1) estados.push((await invitar(adm.token, t, correoNuevo())).error?.status);
    const limitadas = estados.filter((s) => s === 'RESOURCE_EXHAUSTED');
    expect(limitadas.length).toBeGreaterThan(0);
    const ultima = await invitar(adm.token, t, correoNuevo());
    expect((ultima.error?.details as { codigo?: string } | undefined)?.codigo).toMatch(/limite/);
  });

  it('el correo de una cuenta de otro comercio recibe la misma respuesta', async () => {
    const t = await comercio();
    const otro = await comercio();
    const adm = await crearUsuario(h, { rol: 'adm', tenant: t });
    const ajeno = await crearUsuario(h, { rol: 'caj', tenant: otro });
    const nuevo = await invitar(adm.token, t, correoNuevo());
    const existente = await invitar(adm.token, t, ajeno.correo);
    expect(existente.status).toBe(nuevo.status);
    expect(existente.resultado).toEqual(nuevo.resultado);
    // La cuenta ajena conserva su claim: la invitación no lo toca.
    const claims = (await h.auth.getUser(ajeno.uid)).customClaims as { pl?: { t?: Record<string, string> } };
    expect(claims.pl?.t?.[otro]).toBe('caj');
    expect(claims.pl?.t?.[t]).toBeUndefined();
  });

  const claimDe = async (uid: string): Promise<Record<string, string>> =>
    ((await h.auth.getUser(uid)).customClaims as { pl?: { t?: Record<string, string> } } | undefined)?.pl?.t ?? {};

  it('cuenta existente y libre: se invita, se activa al iniciar sesión, queda con el rol y su contraseña no cambia', async () => {
    const t = await comercio();
    const adm = await crearUsuario(h, { rol: 'adm', tenant: t });
    const libre = await crearUsuario(h, {}); // cuenta con contraseña y correo verificado, sin rol en ningún comercio
    const r = await invitar(adm.token, t, libre.correo, 'sup');
    expect(r.status).toBe(200);
    expect(r.resultado).toMatchObject({ ok: true, mensaje: 'Invitación enviada' });
    expect((await miembro(t, libre.uid))?.['estado']).toBe('invitado');
    expect(await claimDe(libre.uid)).toEqual({}); // el rol aún no se escribe
    const a = await llamar('activarInvitaciones', {}, await iniciarSesion(libre.correo));
    expect(a.status).toBe(200);
    expect(a.resultado).toMatchObject({ activadas: 1 });
    expect((await claimDe(libre.uid))[t]).toBe('sup');
    expect((await miembro(t, libre.uid))?.['rol']).toBe('sup');
    expect((await miembro(t, libre.uid))?.['estado']).toBe('activo');
    // La contraseña sigue siendo la misma: iniciar sesión con ella todavía funciona.
    await expect(iniciarSesion(libre.correo)).resolves.toEqual(expect.any(String));
  });

  it('cuenta de otro comercio: se activa y queda con los dos roles', async () => {
    const t = await comercio();
    const otro = await comercio();
    const adm = await crearUsuario(h, { rol: 'adm', tenant: t });
    const ajeno = await crearUsuario(h, { rol: 'caj', tenant: otro });
    expect((await invitar(adm.token, t, ajeno.correo, 'sup')).status).toBe(200);
    const a = await llamar('activarInvitaciones', {}, await iniciarSesion(ajeno.correo));
    expect(a.status).toBe(200);
    expect(a.resultado).toMatchObject({ activadas: 1 });
    expect(await claimDe(ajeno.uid)).toEqual({ [otro]: 'caj', [t]: 'sup' });
  });

  it('miembro activo: la respuesta es idéntica a la de otros casos y nada cambia', async () => {
    const t = await comercio();
    const adm = await crearUsuario(h, { rol: 'adm', tenant: t });
    const activo = await crearUsuario(h, { rol: 'caj', tenant: t });
    await h.firestore.doc(`tenants/${t}/miembros/${activo.uid}`).set({ estado: 'activo', rol: 'caj', uid: activo.uid });
    const antes = (await miembro(t, activo.uid)) ?? {};
    const nuevo = await invitar(adm.token, t, correoNuevo(), 'sup');
    const sobreActivo = await invitar(adm.token, t, activo.correo, 'sup');
    expect(sobreActivo.status).toBe(nuevo.status);
    expect(sobreActivo.resultado).toEqual(nuevo.resultado);
    expect(await miembro(t, activo.uid)).toEqual(antes);
    expect(await claimDe(activo.uid)).toEqual({ [t]: 'caj' });
  });

  it('la auditoría registra la invitación y la activación, sin datos personales', async () => {
    const t = await comercio();
    const adm = await crearUsuario(h, { rol: 'adm', tenant: t });
    const libre = await crearUsuario(h, {});
    await invitar(adm.token, t, libre.correo, 'sup');
    await llamar('activarInvitaciones', {}, await iniciarSesion(libre.correo));
    const docs = (await h.firestore.collection(`tenants/${t}/auditoria`).get()).docs.map((d) => d.data());
    const acciones = docs.map((d) => d['accion']);
    expect(acciones).toContain('miembro.invitar');
    expect(acciones).toContain('miembro.activar');
    const texto = JSON.stringify(docs).toLowerCase();
    expect(texto).not.toContain(libre.correo.toLowerCase());
    expect(texto).not.toContain('@');
  });

  it('sin correo verificado no se activa: correo-no-verificado', async () => {
    const t = await comercio();
    const adm = await crearUsuario(h, { rol: 'adm', tenant: t });
    const correo = correoNuevo();
    await invitar(adm.token, t, correo);
    const uid = await uidDe(correo);
    await h.auth.updateUser(uid, { password: CLAVE, emailVerified: false });
    const a = await llamar('activarInvitaciones', {}, await iniciarSesion(correo));
    expect(a.status).toBe(400);
    expect((a.error?.details as { codigo?: string } | undefined)?.codigo).toBe('correo-no-verificado');
    expect((await miembro(t, uid))?.['estado']).toBe('invitado');
  });

  it('anular borra la cuenta creada solo si nunca inició sesión', async () => {
    const t = await comercio();
    const adm = await crearUsuario(h, { rol: 'adm', tenant: t });
    const nunca = correoNuevo();
    await invitar(adm.token, t, nunca);
    const uidNunca = await uidDe(nunca);
    expect((await accion('consola', 'anularInvitacion', { uid: uidNunca }, adm.token, t)).status).toBe(200);
    await expect(h.auth.getUser(uidNunca)).rejects.toMatchObject({ code: 'auth/user-not-found' });
    expect(await miembro(t, uidNunca)).toBeUndefined();

    const conSesion = correoNuevo();
    await invitar(adm.token, t, conSesion);
    const uidSesion = await uidDe(conSesion);
    await h.auth.updateUser(uidSesion, { password: CLAVE, emailVerified: true });
    await iniciarSesion(conSesion); // inicia sesión sin activar
    expect((await accion('consola', 'anularInvitacion', { uid: uidSesion }, adm.token, t)).status).toBe(200);
    expect((await h.auth.getUser(uidSesion)).uid).toBe(uidSesion);
    expect(await miembro(t, uidSesion)).toBeUndefined();
  });

  it('una cuenta que ya usó el enlace para fijar su contraseña no se borra al anular la invitación', async () => {
    const t = await comercio();
    const adm = await crearUsuario(h, { rol: 'adm', tenant: t });
    const usos = async (): Promise<number> => Number((await h.firestore.doc(`tenants/${t}/contadores/uso`).get()).data()?.['usuarios'] ?? 0);
    const antes = await usos();
    const correo = correoNuevo();
    await invitar(adm.token, t, correo);
    const uid = await uidDe(correo);
    expect(await usos()).toBe(antes + 1);
    const enlace = await h.auth.generatePasswordResetLink(correo);
    const oobCode = new URL(enlace).searchParams.get('oobCode') ?? '';
    const host = process.env['FIREBASE_AUTH_EMULATOR_HOST'] ?? '127.0.0.1:8240';
    const r = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=clave-falsa`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ oobCode, newPassword: CLAVE }),
    });
    expect(r.status).toBe(200); // la persona fijó su clave, sin llegar a entrar
    expect((await accion('consola', 'anularInvitacion', { uid }, adm.token, t)).status).toBe(200);
    expect((await h.auth.getUser(uid)).uid).toBe(uid); // la cuenta se conserva
    expect(await miembro(t, uid)).toBeUndefined(); // la invitación queda anulada
    expect(await usos()).toBe(antes); // y el cupo, liberado
  });

  it('reenviar extiende el vencimiento y responde igual', async () => {
    const t = await comercio();
    const adm = await crearUsuario(h, { rol: 'adm', tenant: t });
    const correo = correoNuevo();
    await invitar(adm.token, t, correo);
    const uid = await uidDe(correo);
    const r = await accion('consola', 'reenviarInvitacion', { uid }, adm.token, t);
    expect(r.status).toBe(200);
    expect(r.resultado).toMatchObject({ ok: true, mensaje: 'Invitación enviada' });
  });

  it('la 11.ª activación en una hora se rechaza (límite por uid)', async () => {
    const t = await comercio();
    const u = await crearUsuario(h, { rol: 'caj', tenant: t, verificado: false });
    const estados: (string | undefined)[] = [];
    for (let i = 0; i < 11; i += 1) estados.push((await llamar('activarInvitaciones', {}, u.token)).error?.status);
    expect(estados.slice(0, 10).every((s) => s !== 'RESOURCE_EXHAUSTED')).toBe(true);
    expect(estados[10]).toBe('RESOURCE_EXHAUSTED');
  });

  it('activarInvitaciones exige sesión', async () => {
    expect((await llamar('activarInvitaciones', {}, undefined)).status).toBe(401);
  });

  it('el índice devuelve solo las invitaciones del uid, con el tenant tomado de la ruta', async () => {
    const t1 = await comercio();
    const t2 = await comercio();
    const uid = unico('uid-a');
    const otro = unico('uid-b');
    await h.firestore.doc(`tenants/${t1}/miembros/${uid}`).set({ estado: 'invitado', uid, rolReservado: 'caj' });
    await h.firestore.doc(`tenants/${t2}/miembros/${uid}`).set({ estado: 'invitado', uid, rolReservado: 'sup' });
    await h.firestore.doc(`tenants/${t1}/miembros/${otro}`).set({ estado: 'invitado', uid: otro, rolReservado: 'caj' });
    // Miembro activo del mismo uid y un documento que miente sobre su uid: no cuentan.
    const t3 = await comercio();
    await h.firestore.doc(`tenants/${t3}/miembros/${uid}`).set({ estado: 'activo', uid, rol: 'caj' });
    const t4 = await comercio();
    await h.firestore.doc(`tenants/${t4}/miembros/${otro}`).set({ estado: 'invitado', uid, tenantId: t1 });
    const indice = crearIndiceInvitaciones(h.firestore);
    expect([...(await indice.tenantsDe(uid))].sort()).toEqual([t1, t2].sort());
    expect(await indice.tenantsDe(unico('uid-nadie'))).toEqual([]);
    expect([...(await indice.invitadosDe(t1))].sort()).toEqual([uid, otro].sort());
  });

  it('fijar la contraseña por enlace: documenta si el emulador deja el correo verificado', async () => {
    const t = await comercio();
    const adm = await crearUsuario(h, { rol: 'adm', tenant: t });
    const correo = correoNuevo();
    await invitar(adm.token, t, correo);
    const uid = await uidDe(correo);
    const enlace = await h.auth.generatePasswordResetLink(correo);
    const oobCode = new URL(enlace).searchParams.get('oobCode') ?? '';
    const host = process.env['FIREBASE_AUTH_EMULATOR_HOST'] ?? '127.0.0.1:8240';
    const r = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=clave-falsa`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ oobCode, newPassword: CLAVE }),
    });
    expect(r.status).toBe(200);
    const verificado = (await h.auth.getUser(uid)).emailVerified;
    console.info(`[invitacion] fijar la contraseña por enlace deja emailVerified=${String(verificado)} en el emulador de Auth`);
    expect(typeof verificado).toBe('boolean');
  });
});
