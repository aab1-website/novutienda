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
  /** Reenvía el correo de verificación (solo tras un inicio con correo no verificado). */
  reenviarVerificacion(): Promise<void>;
}
