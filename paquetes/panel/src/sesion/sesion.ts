import type { Rol } from '@novutienda/nucleo';

/** Usuario autenticado, con tenant y rol ya leídos del claim `pl`. */
export interface UsuarioSesion {
  readonly uid: string;
  readonly correo: string;
  readonly tenantId: string;
  readonly rol: Rol;
}

/** Resultado de iniciar sesión. Un correo sin verificar NO entra. */
export type ResultadoInicio =
  | { readonly tipo: 'ok'; readonly usuario: UsuarioSesion }
  | { readonly tipo: 'correo-no-verificado' }
  | { readonly tipo: 'credenciales-invalidas' }
  | { readonly tipo: 'sin-acceso' }
  | { readonly tipo: 'error'; readonly mensaje: string };

/** Puerto de sesión: Firebase Auth detrás de esta interfaz (`firebase.ts`) o el doble en memoria (`doble.ts`). */
export interface Sesion {
  iniciar(correo: string, contrasena: string): Promise<ResultadoInicio>;
  cerrar(): Promise<void>;
  actual(): UsuarioSesion | null;
  /** Se invoca al cambiar la sesión; devuelve la función para dejar de escuchar. */
  alCambiar(oyente: (u: UsuarioSesion | null) => void): () => void;
  /** Fuerza la renovación del token de la sesión actual; `false` si no hay sesión o el servidor la rechaza. */
  renovar(): Promise<boolean>;
  /** Reenvía el correo de verificación (solo tras un inicio con correo no verificado). */
  reenviarVerificacion(): Promise<void>;
  /**
   * Envía el correo de restablecimiento de contraseña. Siempre se resuelve igual, exista o no la cuenta (y falle o no el
   * envío): quien llama no puede saber si el correo tiene una cuenta.
   */
  recuperarContrasena(correo: string): Promise<void>;
  /**
   * Envía el enlace para fijar la contraseña tras invitar o reenviar. `true` si salió o si la cuenta no existe (no se distingue,
   * para no revelar nada); `false` solo ante un fallo real del envío (red, límite del servicio).
   */
  enviarEnlaceDeAcceso(correo: string): Promise<boolean>;
}
