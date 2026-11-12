import { initializeApp, type FirebaseOptions } from 'firebase/app';
import {
  browserLocalPersistence, connectAuthEmulator, indexedDBLocalPersistence, initializeAuth, onAuthStateChanged, sendEmailVerification, signInWithEmailAndPassword, signOut, type Auth, type User,
} from 'firebase/auth';
import { leerClaimPanel } from './claim.js';
import type { ResultadoInicio, Sesion, UsuarioSesion } from './sesion.js';

/** Sesión real con Firebase Auth (correo y contraseña). Un correo no verificado cierra la sesión y no entra. */
export class SesionFirebase implements Sesion {
  private readonly auth: Auth;
  private usuario: UsuarioSesion | null = null;
  private pendiente: User | null = null;
  private readonly oyentes = new Set<(u: UsuarioSesion | null) => void>();

  /** `urlEmulador`: solo en la compilación de pruebas contra el emulador de Auth. */
  constructor(config: FirebaseOptions, urlEmulador?: string) {
    // Sin resolvedor de ventanas emergentes: no se cargan marcos ni scripts de Google (CSP estricta).
    this.auth = initializeAuth(initializeApp(config), { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
    if (urlEmulador !== undefined) connectAuthEmulator(this.auth, urlEmulador, { disableWarnings: true });
    onAuthStateChanged(this.auth, (u) => {
      void this.adoptar(u).then((x) => {
        this.usuario = x;
        for (const o of this.oyentes) o(x);
      });
    });
  }

  private async adoptar(u: User | null): Promise<UsuarioSesion | null> {
    if (u === null || !u.emailVerified) return null;
    const token = await u.getIdTokenResult(true);
    const c = leerClaimPanel(token.claims);
    return c === null ? null : { uid: u.uid, correo: u.email ?? '', tenantId: c.tenantId, rol: c.rol };
  }

  async iniciar(correo: string, contrasena: string): Promise<ResultadoInicio> {
    try {
      const cred = await signInWithEmailAndPassword(this.auth, correo.trim(), contrasena);
      if (!cred.user.emailVerified) {
        // No se entra: `adoptar` devuelve null mientras el correo no esté verificado. Se conserva el usuario para reenviar.
        this.pendiente = cred.user;
        return { tipo: 'correo-no-verificado' };
      }
      const usuario = await this.adoptar(cred.user);
      if (usuario === null) {
        await signOut(this.auth);
        return { tipo: 'sin-acceso' };
      }
      this.usuario = usuario;
      return { tipo: 'ok', usuario };
    } catch (e) {
      const codigo = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '';
      if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(codigo)) return { tipo: 'credenciales-invalidas' };
      if (/too-many-requests/.test(codigo)) return { tipo: 'error', mensaje: 'Demasiados intentos. Espere unos minutos.' };
      if (/network/.test(codigo)) return { tipo: 'error', mensaje: 'No hay conexión. Revise su internet.' };
      return { tipo: 'error', mensaje: 'No se pudo iniciar sesión. Intente de nuevo.' };
    }
  }

  async cerrar(): Promise<void> {
    await signOut(this.auth);
  }

  actual(): UsuarioSesion | null {
    return this.usuario;
  }

  alCambiar(oyente: (u: UsuarioSesion | null) => void): () => void {
    this.oyentes.add(oyente);
    return () => void this.oyentes.delete(oyente);
  }

  async renovar(): Promise<boolean> {
    const u = this.auth.currentUser;
    if (u === null) return false;
    try {
      await u.getIdToken(true);
      return true;
    } catch {
      return false;
    }
  }

  async reenviarVerificacion(): Promise<void> {
    if (this.pendiente !== null) await sendEmailVerification(this.pendiente);
  }
}
