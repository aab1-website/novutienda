// Los correos de Firebase Auth se piden en español: el idioma queda fijado antes del primer envío.
import { describe, expect, it, vi } from 'vitest';

const fb = vi.hoisted(() => {
  const auth: { currentUser: null; languageCode: string | null } = { currentUser: null, languageCode: null };
  const vistos: Array<string | null> = [];
  return {
    auth,
    vistos,
    reinicio: vi.fn(async () => void vistos.push(auth.languageCode)),
    verificacion: vi.fn(async () => void vistos.push(auth.languageCode)),
  };
});
vi.mock('firebase/app', () => ({ initializeApp: () => ({}) }));
vi.mock('firebase/auth', () => ({
  browserLocalPersistence: {},
  indexedDBLocalPersistence: {},
  connectAuthEmulator: () => undefined,
  initializeAuth: () => fb.auth,
  onAuthStateChanged: () => undefined,
  sendEmailVerification: fb.verificacion,
  sendPasswordResetEmail: fb.reinicio,
  signInWithEmailAndPassword: async () => ({ user: { emailVerified: false } }),
  signOut: async () => undefined,
}));
vi.mock('../api/firebase.js', () => ({ TransporteFirebase: class {} }));

const { SesionFirebase } = await import('./firebase.js');

describe('idioma de los correos de Firebase Auth', () => {
  it('queda en español desde el inicio y está fijado en cada envío', async () => {
    const s = new SesionFirebase({ apiKey: 'x', authDomain: 'x', projectId: 'x' });
    expect(fb.auth.languageCode).toBe('es');
    await s.recuperarContrasena('ana@ejemplo.test');
    await s.enviarEnlaceDeAcceso('ana@ejemplo.test');
    await s.iniciar('ana@ejemplo.test', 'clave');
    await s.reenviarVerificacion();
    expect(fb.vistos.length).toBeGreaterThanOrEqual(3);
    expect(fb.vistos.every((l) => l === 'es')).toBe(true);
  });
});
