// Activación de invitaciones al entrar (U-01): una cuenta sin rol llama a la activación UNA vez, refresca el token y entra con
// su rol; si el servidor dice que el correo no está verificado, se envía el correo de verificación y no entra.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorApi } from '../api/errores.js';
import { ClienteDoble } from '../doble/doble.js';
import { conCorreoDeInvitacion } from '../api/invitaciones.js';
import { SesionDoble, type CuentaDoble } from './doble.js';

const fb = vi.hoisted(() => ({
  signIn: vi.fn(),
  verificacion: vi.fn(async () => undefined),
  reinicio: vi.fn(async () => undefined),
}));
vi.mock('firebase/app', () => ({ initializeApp: () => ({}) }));
vi.mock('firebase/auth', () => ({
  browserLocalPersistence: {},
  indexedDBLocalPersistence: {},
  connectAuthEmulator: () => undefined,
  initializeAuth: () => ({ currentUser: null }),
  onAuthStateChanged: () => undefined,
  sendEmailVerification: fb.verificacion,
  sendPasswordResetEmail: fb.reinicio,
  signInWithEmailAndPassword: fb.signIn,
  signOut: async () => undefined,
}));
// Las acciones nuevas aún no están en la tabla generada de roles (se regenera aparte); al regenerarla, este bloque sobra.
vi.mock('../api/acciones.generado.js', async (original) => {
  const m = await original<typeof import('../api/acciones.generado.js')>();
  return { ...m, ROLES_ACCION: { ...m.ROLES_ACCION, 'consola.invitarUsuario': ['adm'], 'consola.anularInvitacion': ['adm'], 'consola.reenviarInvitacion': ['adm'] } };
});
vi.mock('../api/firebase.js', () => ({ TransporteFirebase: class {} }));

const { SesionFirebase } = await import('./firebase.js');

const usuarioFb = (claims: unknown[]): { uid: string; email: string; emailVerified: boolean; getIdTokenResult: ReturnType<typeof vi.fn> } => {
  const sigue = [...claims];
  return { uid: 'u1', email: 'ana@ejemplo.test', emailVerified: true, getIdTokenResult: vi.fn(async () => ({ claims: sigue.length > 1 ? sigue.shift() : sigue[0] })) };
};
const conRol = { pl: { t: { demo: 'caj' }, v: 1 } };

describe('activación al iniciar sesión (Firebase)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sin rol en ningún comercio: activa una vez, refresca el token y entra con el rol', async () => {
    const u = usuarioFb([{}, conRol]);
    fb.signIn.mockResolvedValue({ user: u });
    const activador = vi.fn(async () => ({ activadas: 1, sinEfecto: 0, fallidas: 0 }));
    const s = new SesionFirebase({ apiKey: 'x', authDomain: 'x', projectId: 'x' }, undefined, activador);
    const r = await s.iniciar('ana@ejemplo.test', 'clave');
    expect(r).toMatchObject({ tipo: 'ok', usuario: { rol: 'caj', tenantId: 'demo' } });
    expect(activador).toHaveBeenCalledTimes(1);
    expect(u.getIdTokenResult).toHaveBeenCalledTimes(2); // lectura inicial y refresco tras activar
  });

  it('con rol no llama a la activación', async () => {
    fb.signIn.mockResolvedValue({ user: usuarioFb([conRol]) });
    const activador = vi.fn(async () => ({ activadas: 0 }));
    const s = new SesionFirebase({ apiKey: 'x', authDomain: 'x', projectId: 'x' }, undefined, activador);
    expect((await s.iniciar('ana@ejemplo.test', 'clave')).tipo).toBe('ok');
    expect(activador).not.toHaveBeenCalled();
  });

  it('sin invitaciones (nada que activar) no entra y no insiste en la misma sesión', async () => {
    fb.signIn.mockResolvedValue({ user: usuarioFb([{}]) });
    const activador = vi.fn(async () => ({ activadas: 0, sinEfecto: 0, fallidas: 0 }));
    const s = new SesionFirebase({ apiKey: 'x', authDomain: 'x', projectId: 'x' }, undefined, activador);
    expect((await s.iniciar('ana@ejemplo.test', 'clave')).tipo).toBe('sin-acceso');
    expect((await s.iniciar('ana@ejemplo.test', 'clave')).tipo).toBe('sin-acceso');
    expect(activador).toHaveBeenCalledTimes(1);
  });

  it('si el servidor responde correo-no-verificado, envía la verificación y pide verificar el correo', async () => {
    const u = usuarioFb([{}]);
    fb.signIn.mockResolvedValue({ user: u });
    const activador = vi.fn(async () => {
      throw new ErrorApi('failed-precondition', 'x', { codigo: 'correo-no-verificado' });
    });
    const s = new SesionFirebase({ apiKey: 'x', authDomain: 'x', projectId: 'x' }, undefined, activador);
    expect(await s.iniciar('ana@ejemplo.test', 'clave')).toEqual({ tipo: 'correo-no-verificado' });
    expect(fb.verificacion).toHaveBeenCalledTimes(1);
    expect(s.actual()).toBeNull();
  });

  it('un fallo de red en la activación no entra, no rompe y se reintenta en la siguiente entrada', async () => {
    fb.signIn.mockResolvedValue({ user: usuarioFb([{}]) });
    const activador = vi.fn(async () => {
      throw new ErrorApi('unavailable', 'x');
    });
    const s = new SesionFirebase({ apiKey: 'x', authDomain: 'x', projectId: 'x' }, undefined, activador);
    expect((await s.iniciar('ana@ejemplo.test', 'clave')).tipo).toBe('sin-acceso');
    await s.iniciar('ana@ejemplo.test', 'clave');
    expect(activador).toHaveBeenCalledTimes(2);
  });
});

describe('activación al iniciar sesión (doble)', () => {
  const cuenta = (activacion: CuentaDoble['activacion']): CuentaDoble => ({ correo: 'inv@ejemplo.test', contrasena: 'clave-inv-1', uid: 'u-inv', tenantId: 'demo', rol: 'sup', verificado: true, ...(activacion !== undefined ? { activacion } : {}) });

  it('la invitación pendiente se activa al entrar, una sola vez, y renueva el token', async () => {
    const s = new SesionDoble([cuenta('pendiente')]);
    expect(await s.iniciar('inv@ejemplo.test', 'clave-inv-1')).toMatchObject({ tipo: 'ok', usuario: { rol: 'sup' } });
    expect([s.activaciones, s.renovaciones]).toEqual([1, 1]);
    await s.cerrar();
    await s.iniciar('inv@ejemplo.test', 'clave-inv-1');
    expect(s.activaciones).toBe(1);
  });

  it('correo no verificado según el servidor: envía la verificación y no entra', async () => {
    const s = new SesionDoble([cuenta('servidor-no-verificado')]);
    expect(await s.iniciar('inv@ejemplo.test', 'clave-inv-1')).toEqual({ tipo: 'correo-no-verificado' });
    expect(s.verificacionesReenviadas).toBe(1);
    expect(s.actual()).toBeNull();
  });
});

describe('correo del enlace tras invitar o reenviar', () => {
  it('envía el correo solo si la acción tuvo éxito, y nunca por otras acciones', async () => {
    const enviados: string[] = [];
    const api = conCorreoDeInvitacion(new ClienteDoble({ usuario: () => ({ uid: 'u-adm', rol: 'adm' }) }), { recuperarContrasena: async (c) => void enviados.push(c) });
    await api.llamar('quitarRol', { uid: 'u-sup' });
    await api.llamar('listarUsuarios', {});
    expect(enviados).toEqual([]);
    await api.llamar('invitarUsuario', { correo: 'ana@ejemplo.test', rol: 'caj' });
    expect(enviados).toEqual(['ana@ejemplo.test']);
    expect(api.estado.usuarios.some((u) => u.estado === 'invitado')).toBe(true); // conserva el estado del doble
    await expect(api.llamar('invitarUsuario', { correo: 'otra@ejemplo.test', rol: 'caj' })).rejects.toBeInstanceOf(ErrorApi); // plan lleno
    expect(enviados).toEqual(['ana@ejemplo.test']);
  });

  it('un fallo al enviar no deshace la invitación', async () => {
    const api = conCorreoDeInvitacion(new ClienteDoble({ usuario: () => ({ uid: 'u-adm', rol: 'adm' }) }), {
      recuperarContrasena: () => Promise.reject(new Error('sin red')),
    });
    await api.llamar('quitarRol', { uid: 'u-sup' });
    await expect(api.llamar('invitarUsuario', { correo: 'ana@ejemplo.test', rol: 'caj' })).resolves.toMatchObject({ ok: true });
  });
});
