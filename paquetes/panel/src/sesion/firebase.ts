import { initializeApp, type FirebaseOptions } from 'firebase/app';
import {
  browserLocalPersistence, connectAuthEmulator, indexedDBLocalPersistence, initializeAuth, onAuthStateChanged, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, type Auth, type User,
} from 'firebase/auth';
import { TransporteFirebase } from '../api/firebase.js';
import { leerClaimPanel } from './claim.js';
import type { ResultadoInicio, Sesion, UsuarioSesion } from './sesion.js';

export const MENSAJE_SIN_CONEXION = 'No se pudo comprobar su acceso. Revise su conexión.';

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
    // Los correos de Firebase Auth (restablecer contraseña, verificación) salen en español; se fija una vez, antes de cualquier envío.
    this.auth.languageCode = 'es';
    if (urlEmulador !== undefined) connectAuthEmulator(this.auth, urlEmulador, { disableWarnings: true });
    onAuthStateChanged(this.auth, (u) => {
      void this.adoptar(u).then((x) => {
        this.usuario = x;
        for (const o of this.oyentes) o(x);
      });
    });
  }

  private async adoptar(u: User | null): Promise<UsuarioSesion | null> {
    return (await this.evaluar(u, false)).usuario;
  }

  /**
   * Lee el rol del claim.
   * - Sin rol en ningún comercio: activa sus invitaciones (al cargar, una vez por cuenta; en un inicio explícito, siempre una
   *   consulta nueva) y, si activó alguna, refresca el token para que el rol aparezca. Si el servidor dice que el correo no está
   *   verificado, envía la verificación y lo informa. Si la consulta falla (red), lo informa como `sinConexion`.
   * - Con rol: solo en un inicio explícito (la persona escribió su contraseña) se comprueba UNA vez, en segundo plano y sin
   *   bloquear la entrada, si tiene una invitación a otro comercio; si activó algo, refresca el token y avisa.
   */
  private async evaluar(u: User | null, explicito: boolean): Promise<{ usuario: UsuarioSesion | null; sinVerificar: boolean; sinConexion: boolean }> {
    if (u === null || !u.emailVerified) return { usuario: null, sinVerificar: false, sinConexion: false };
    let c = leerClaimPanel((await u.getIdTokenResult(true)).claims);
    if (c === null) {
      const r = await this.activar(u, explicito);
      if (r === 'correo-no-verificado') {
        this.pendiente = u;
        try {
          await sendEmailVerification(u);
        } catch {
          // El envío puede fallar (límite del servicio); el usuario puede pedirlo de nuevo con «Reenviar enlace».
        }
        return { usuario: null, sinVerificar: true, sinConexion: false };
      }
      if (r === 'error') return { usuario: null, sinVerificar: false, sinConexion: true };
      if (r === 'activadas') c = leerClaimPanel((await u.getIdTokenResult(true)).claims);
    } else if (explicito) {
      void this.activarEnSegundoPlano(u, c.tenantId, c.rol);
    }
    return { usuario: c === null ? null : { uid: u.uid, correo: u.email ?? '', tenantId: c.tenantId, rol: c.rol }, sinVerificar: false, sinConexion: false };
  }

  private async activarEnSegundoPlano(u: User, tenantId: string, rol: UsuarioSesion['rol']): Promise<void> {
    try {
      if ((await this.activar(u, true)) !== 'activadas') return;
      const c = leerClaimPanel((await u.getIdTokenResult(true)).claims);
      if (c === null || (c.tenantId === tenantId && c.rol === rol)) return;
      this.usuario = { uid: u.uid, correo: u.email ?? '', tenantId: c.tenantId, rol: c.rol };
      for (const o of this.oyentes) o(this.usuario);
    } catch {
      // En segundo plano: un fallo no afecta a la sesión ya abierta.
    }
  }

  private activar(u: User, nueva = false): Promise<'activadas' | 'nada' | 'correo-no-verificado' | 'error'> {
    const previa = nueva ? undefined : this.activaciones.get(u.uid);
    if (previa !== undefined) return previa;
    const consulta = this.activador().then(
      (r): 'activadas' | 'nada' => (typeof r === 'object' && r !== null && Number((r as { activadas?: unknown }).activadas) > 0 ? 'activadas' : 'nada'),
      (e: unknown): 'correo-no-verificado' | 'error' => {
        const d = typeof e === 'object' && e !== null ? (e as { detalle?: { codigo?: unknown } }).detalle : undefined;
        return d?.codigo === 'correo-no-verificado' ? 'correo-no-verificado' : 'error';
      },
    );
    this.activaciones.set(u.uid, consulta);
    // Un fallo no definitivo (red, servicio) no se recuerda: la próxima entrada lo intenta de nuevo.
    void consulta.then((r) => {
      if ((r === 'error' || r === 'correo-no-verificado') && this.activaciones.get(u.uid) === consulta) this.activaciones.delete(u.uid);
    });
    return consulta;
  }

  async iniciar(correo: string, contrasena: string): Promise<ResultadoInicio> {
    try {
      const cred = await signInWithEmailAndPassword(this.auth, correo.trim(), contrasena);
      if (!cred.user.emailVerified) {
        // No se entra: `adoptar` devuelve null mientras el correo no esté verificado. Se conserva el usuario para reenviar.
        this.pendiente = cred.user;
        return { tipo: 'correo-no-verificado' };
      }
      const { usuario, sinVerificar, sinConexion } = await this.evaluar(cred.user, true);
      if (sinVerificar) return { tipo: 'correo-no-verificado' };
      if (sinConexion) return { tipo: 'error', mensaje: MENSAJE_SIN_CONEXION };
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

  async enviarEnlaceDeAcceso(correo: string): Promise<boolean> {
    try {
      await sendPasswordResetEmail(this.auth, correo.trim());
      return true;
    } catch (e) {
      const codigo = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : 'desconocido';
      console.warn('Enlace de acceso no enviado', codigo);
      // Cuenta inexistente (o sin invitar): igual que un envío correcto, para no revelar nada.
      return /user-not-found|invalid-email/.test(codigo);
    }
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
