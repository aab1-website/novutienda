import { initializeApp, type FirebaseOptions } from 'firebase/app';
import {
  browserLocalPersistence, connectAuthEmulator, indexedDBLocalPersistence, initializeAuth, onAuthStateChanged, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, type Auth, type User,
} from 'firebase/auth';
import { TransporteFirebase } from '../api/firebase.js';
import { leerClaimPanel } from './claim.js';
import type { ResultadoInicio, Sesion, UsuarioSesion } from './sesion.js';

/** Sesión real con Firebase Auth (correo y contraseña). Un correo no verificado cierra la sesión y no entra. */
export class SesionFirebase implements Sesion {
  private readonly auth: Auth;
  private usuario: UsuarioSesion | null = null;
  private pendiente: User | null = null;
  private readonly oyentes = new Set<(u: UsuarioSesion | null) => void>();
  /** Activaciones de invitaciones ya hechas o en curso: una sola por cuenta y por carga de la página. */
  private readonly activaciones = new Map<string, Promise<'activadas' | 'nada' | 'correo-no-verificado' | 'error'>>();

  /**
   * `urlEmulador`: solo en la compilación de pruebas contra el emulador de Auth. `activador` llama al callable que activa las
   * invitaciones de la cuenta (por omisión, el callable real).
   */
  constructor(
    config: FirebaseOptions,
    urlEmulador?: string,
    private readonly activador: () => Promise<unknown> = () => new TransporteFirebase().activarInvitaciones(),
  ) {
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
    return (await this.evaluar(u)).usuario;
  }

  /**
   * Lee el rol del claim. Si la cuenta no tiene rol en ningún comercio, intenta UNA vez activar sus invitaciones y, si activó
   * alguna, refresca el token para que el rol aparezca. Si el servidor dice que el correo no está verificado, envía el correo
   * de verificación y lo informa (no entra).
   */
  private async evaluar(u: User | null): Promise<{ usuario: UsuarioSesion | null; sinVerificar: boolean }> {
    if (u === null || !u.emailVerified) return { usuario: null, sinVerificar: false };
    let c = leerClaimPanel((await u.getIdTokenResult(true)).claims);
    if (c === null) {
      const r = await this.activar(u);
      if (r === 'correo-no-verificado') {
        this.pendiente = u;
        try {
          await sendEmailVerification(u);
        } catch {
          // El envío puede fallar (límite del servicio); el usuario puede pedirlo de nuevo con «Reenviar enlace».
        }
        return { usuario: null, sinVerificar: true };
      }
      if (r === 'activadas') c = leerClaimPanel((await u.getIdTokenResult(true)).claims);
    }
    return { usuario: c === null ? null : { uid: u.uid, correo: u.email ?? '', tenantId: c.tenantId, rol: c.rol }, sinVerificar: false };
  }

  private activar(u: User): Promise<'activadas' | 'nada' | 'correo-no-verificado' | 'error'> {
    const previa = this.activaciones.get(u.uid);
    if (previa !== undefined) return previa;
    const nueva = this.activador().then(
      (r): 'activadas' | 'nada' => (typeof r === 'object' && r !== null && Number((r as { activadas?: unknown }).activadas) > 0 ? 'activadas' : 'nada'),
      (e: unknown): 'correo-no-verificado' | 'error' => {
        const d = typeof e === 'object' && e !== null ? (e as { detalle?: { codigo?: unknown } }).detalle : undefined;
        return d?.codigo === 'correo-no-verificado' ? 'correo-no-verificado' : 'error';
      },
    );
    this.activaciones.set(u.uid, nueva);
    // Un fallo no definitivo (red, servicio) no se recuerda: la próxima entrada lo intenta de nuevo.
    void nueva.then((r) => {
      if (r === 'error' || r === 'correo-no-verificado') this.activaciones.delete(u.uid);
    });
    return nueva;
  }

  async iniciar(correo: string, contrasena: string): Promise<ResultadoInicio> {
    try {
      const cred = await signInWithEmailAndPassword(this.auth, correo.trim(), contrasena);
      if (!cred.user.emailVerified) {
        // No se entra: `adoptar` devuelve null mientras el correo no esté verificado. Se conserva el usuario para reenviar.
        this.pendiente = cred.user;
        return { tipo: 'correo-no-verificado' };
      }
      const { usuario, sinVerificar } = await this.evaluar(cred.user);
      if (sinVerificar) return { tipo: 'correo-no-verificado' };
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

  async recuperarContrasena(correo: string): Promise<void> {
    try {
      await sendPasswordResetEmail(this.auth, correo.trim());
    } catch (e) {
      // Solo el código del error (nunca el correo) queda en el registro del navegador.
      const codigo = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : 'desconocido';
      console.warn('Restablecimiento de contraseña no enviado', codigo);
      // Cuenta inexistente, correo mal escrito o servicio caído: la respuesta es la misma, para no revelar qué correos tienen cuenta.
    }
  }
}
