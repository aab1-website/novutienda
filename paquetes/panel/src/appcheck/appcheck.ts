import type { FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck, type AppCheckOptions } from 'firebase/app-check';

/**
 * Resultado de la inicialización: `recaptcha` (producción y staging), `emulador` (token simulado del emulador, solo en la
 * compilación `emulador`) u `omitido` (sin clave de sitio: no se inicializa y las llamadas van sin token).
 */
export type EstadoAppCheck = 'recaptcha' | 'emulador' | 'omitido';

export interface OpcionesAppCheck {
  /** Clave de SITIO de reCAPTCHA Enterprise (pública), de la variable de compilación `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`. */
  readonly claveSitio: string | undefined;
  /** Solo la compilación contra los emuladores: proveedor propio con el token que el servidor simulado acepta. */
  readonly proveedorEmulador?: AppCheckOptions['provider'];
  /** Para pruebas: sustituye a `initializeAppCheck`. */
  readonly inicializar?: (app: FirebaseApp, opciones: AppCheckOptions) => AppCheck;
  /** Para pruebas: registro en consola. */
  readonly registrar?: (mensaje: string) => void;
}

let estado: EstadoAppCheck | null = null;

/**
 * Inicializa Firebase App Check una sola vez por página. El SDK de Functions toma el token de App Check de la misma app y lo
 * envía en la cabecera `X-Firebase-AppCheck` de cada callable; no hay código de envío propio. Sin clave de sitio no se
 * inicializa y se deja constancia en consola (el servidor lo rechazará si `APP_CHECK_EXIGIDO=true`).
 */
export function iniciarAppCheck(app: FirebaseApp, o: OpcionesAppCheck): EstadoAppCheck {
  if (estado !== null) return estado;
  const inicializar = o.inicializar ?? initializeAppCheck;
  const registrar = o.registrar ?? ((m: string) => console.warn(m));
  if (o.proveedorEmulador !== undefined) {
    inicializar(app, { provider: o.proveedorEmulador, isTokenAutoRefreshEnabled: false });
    estado = 'emulador';
  } else if (o.claveSitio !== undefined && o.claveSitio.trim() !== '') {
    inicializar(app, { provider: new ReCaptchaEnterpriseProvider(o.claveSitio.trim()), isTokenAutoRefreshEnabled: true });
    estado = 'recaptcha';
  } else {
    registrar('App Check no se inicializó: falta VITE_RECAPTCHA_ENTERPRISE_SITE_KEY en la compilación. Las llamadas al servidor irán sin token.');
    estado = 'omitido';
  }
  return estado;
}

/** Solo para pruebas: permite reinicializar. */
export function reiniciarAppCheckParaPruebas(): void {
  estado = null;
}
