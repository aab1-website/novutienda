/**
 * App Check de un solo uso para el formulario de contacto. El servidor exige un token por envío (`consume: true`) y espera que el
 * navegador exponga `window.cbAppCheck`, una función asíncrona que devuelve un token. Aquí se implementa ese proveedor con el SDK
 * de Firebase (reCAPTCHA Enterprise + `getLimitedUseToken`). El SDK es pesado: se descarga solo al enfocar el formulario.
 * Dominios que esto agrega a la CSP (ver `seguridad/csp.ts`): `content-firebaseappcheck.googleapis.com` (intercambio del token) y los de
 * reCAPTCHA Enterprise, que el proveedor del SDK carga desde `www.google.com/recaptcha/enterprise.js`.
 */
import type { FirebaseApp, FirebaseOptions } from 'firebase/app';
import type { AppCheck, AppCheckOptions, AppCheckTokenResult } from 'firebase/app-check';
import type { ConfigAppCheck } from '../contenido/tipos.js';
import type { ProveedorAppCheck } from './recaptcha.js';

/** Lo que se usa del SDK; en las pruebas se sustituye por un doble. */
export interface SdkAppCheck {
  initializeApp(opciones: FirebaseOptions, nombre: string): FirebaseApp;
  initializeAppCheck(app: FirebaseApp, opciones: AppCheckOptions): AppCheck;
  crearProveedor(claveSitio: string): AppCheckOptions['provider'];
  getLimitedUseToken(appCheck: AppCheck): Promise<AppCheckTokenResult>;
}

/** Nombre propio de la app: no choca con ninguna otra app de Firebase de la página. */
const NOMBRE_APP = 'cb-contacto';

export async function cargarSdk(): Promise<SdkAppCheck> {
  const [app, ac] = await Promise.all([import('firebase/app'), import('firebase/app-check')]);
  return {
    initializeApp: (o, n) => app.initializeApp(o, n),
    initializeAppCheck: (a, o) => ac.initializeAppCheck(a, o),
    crearProveedor: (clave) => new ac.ReCaptchaEnterpriseProvider(clave),
    getLimitedUseToken: (c) => ac.getLimitedUseToken(c),
  };
}

/**
 * Crea el proveedor de tokens. La inicialización ocurre una sola vez y es perezosa: nada se descarga hasta `preparar()` o hasta el
 * primer token. Si la inicialización falla se descarta para poder reintentar. Cada llamada del proveedor pide un token NUEVO de un solo uso.
 */
export function crearProveedorAppCheck(config: ConfigAppCheck, cargar: () => Promise<SdkAppCheck> = cargarSdk): { readonly preparar: () => Promise<void>; readonly token: ProveedorAppCheck } {
  let listo: Promise<{ sdk: SdkAppCheck; appCheck: AppCheck }> | null = null;
  const preparar = (): Promise<{ sdk: SdkAppCheck; appCheck: AppCheck }> => {
    listo ??= cargar()
      .then((sdk) => {
        const app = sdk.initializeApp({ apiKey: config.apiKey, appId: config.appId, projectId: config.projectId }, NOMBRE_APP);
        const appCheck = sdk.initializeAppCheck(app, { provider: sdk.crearProveedor(config.claveSitio), isTokenAutoRefreshEnabled: false });
        return { sdk, appCheck };
      })
      .catch((e: unknown) => {
        listo = null;
        throw e;
      });
    return listo;
  };
  return {
    preparar: async () => void (await preparar()),
    token: async () => {
      const { sdk, appCheck } = await preparar();
      return (await sdk.getLimitedUseToken(appCheck)).token;
    },
  };
}

/** Registra `window.cbAppCheck` (contrato con el servidor) y devuelve el proveedor. Sin configuración no registra nada. */
export function instalarCbAppCheck(config: ConfigAppCheck | null, destino: Record<string, unknown> = window as unknown as Record<string, unknown>, cargar?: () => Promise<SdkAppCheck>): { readonly preparar: () => Promise<void> } | null {
  if (config === null) return null;
  const p = crearProveedorAppCheck(config, cargar);
  destino['cbAppCheck'] = p.token;
  return p;
}
