// Configuración de las funciones. Nada de identificadores del proyecto ni de secretos en el repositorio:
// los valores salen de parámetros de despliegue (`.env.<alias>` o variables) y de Secret Manager.
// `.value()` solo se llama dentro de un manejador, nunca al cargar el módulo.
import { defineBoolean, defineSecret, defineString } from 'firebase-functions/params';

export const REGION = 'us-east1';

export const PARAMETROS = {
  /**
   * Cuenta de servicio con la que corren las Functions (nombre corto o correo). Vacío = la cuenta por defecto de Compute
   * (firebase-tools lo trata como «sin cuenta»). En producción debe ser una cuenta dedicada con roles mínimos
   * (docs/produccion/pase-a-staging.md, paso 6).
   */
  cuentaServicio: defineString('FUNCIONES_SERVICE_ACCOUNT', { default: '' }),
  /**
   * Cuántos proxies de confianza anteponen su dirección en `X-Forwarded-For` (el cliente es el elemento que queda
   * a esa distancia del final). Detrás de Hosting (Fastly) y del GFE de Cloud Run son 2. Ver `origen.ts`.
   */
  proxySaltos: defineString('PROXY_SALTOS', { default: '2' }),
  /** `true` en producción: rechaza llamadas sin token de App Check válido. */
  appCheckExigido: defineBoolean('APP_CHECK_EXIGIDO', { default: false }),
  /** `real` (reCAPTCHA Enterprise) o `simulado` (solo emulador y pruebas). */
  recaptchaModo: defineString('RECAPTCHA_MODO', { default: 'real' }),
  recaptchaClaveSitio: defineString('RECAPTCHA_CLAVE_SITIO', { default: '' }),
  /** `real` (Admin App Check) o `simulado` (solo emulador y pruebas). */
  appCheckModo: defineString('APP_CHECK_MODO', { default: 'real' }),
  /** URL pública del sitio (para `urlProducto` del catálogo), sin barra final. */
  sitioUrl: defineString('SITIO_URL', { default: '' }),
  /**
   * Base pública de los medios (Hosting o CDN o un bucket público APARTE solo para `publico/`), sin barra final. Obligatoria
   * fuera del emulador y de las pruebas: NO hay valor por defecto a `storage.googleapis.com/<bucket por defecto>`, porque
   * eso empujaría a abrir con `allUsers` el bucket que guarda originales y PDF de recibos.
   */
  mediosBaseUrl: defineString('MEDIOS_BASE_URL', { default: '' }),
  /**
   * Bucket PÚBLICO de los medios (solo `tenants/<t>/publico/medios/`), distinto del bucket por defecto que guarda originales
   * y PDF de recibos. Obligatorio fuera del emulador y de las pruebas (falla cerrado: nunca se publica en el por defecto).
   * Debe ser el bucket que sirve `MEDIOS_BASE_URL`.
   */
  mediosBucketPublico: defineString('MEDIOS_BUCKET_PUBLICO', { default: '' }),
  /** Binarios de video (opcionales: sin ellos el video se rechaza con un error claro). */
  ffmpegPath: defineString('FFMPEG_PATH', { default: '' }),
  ffprobePath: defineString('FFPROBE_PATH', { default: '' }),
  /** Peticiones por ventana al formulario de contacto, por origen. */
  contactoMaximo: defineString('CONTACTO_MAXIMO', { default: '5' }),
  contactoVentanaSeg: defineString('CONTACTO_VENTANA_SEG', { default: '600' }),
  /** Peticiones por minuto a la API de NovuChat, por token (Firestore) y por origen y por instancia (memoria, antes de autenticar). */
  novuchatMaximoPorMinuto: defineString('NOVUCHAT_MAXIMO_POR_MINUTO', { default: '120' }),
  /** Peticiones por minuto a `/api/disponibilidad`, por origen y por instancia (memoria). */
  disponibilidadMaximoPorMinuto: defineString('DISPONIBILIDAD_MAXIMO_POR_MINUTO', { default: '60' }),
  /** Peticiones por minuto a `/api/contacto`, por origen y por instancia (memoria), antes de verificar App Check. */
  contactoMaximoPorMinuto: defineString('CONTACTO_MAXIMO_POR_MINUTO', { default: '30' }),
  /**
   * Repositorio (`owner/nombre`) cuyo workflow `reconstruir-sitio.yml` se avisa tras pasar un trabajo a `reconstruir` (S7-3).
   * Vacío = disparo deshabilitado: el trabajo queda `pendiente` y lo recoge el sondeo programado, como antes.
   */
  githubRepoSitio: defineString('GITHUB_REPO_SITIO', { default: '' }),
  /**
   * `si` solo en staging: habilita el plan `pruebas`. Con cualquier otro valor, un tenant con ese plan se trata como inválido
   * (falla cerrado). Producción NO debe fijarlo.
   */
  planPruebasHabilitado: defineString('PLAN_PRUEBAS_HABILITADO', { default: '' }),
  /**
   * `github` (por defecto: el sitio lo reconstruye el workflow de GitHub, como siempre) o `google` (Cloud Build, DR-CB). Cualquier
   * otro valor se trata como `github`: el interruptor falla hacia lo que ya funciona. Volver atrás es cambiar este parámetro.
   */
  constructorSitioModo: defineString('CONSTRUCTOR_SITIO_MODO', { default: 'github' }),
  /** Imagen del constructor fijada por digest (`…@sha256:…`); la escribe el CI. Obligatoria solo en modo `google`. */
  constructorSitioImagen: defineString('CONSTRUCTOR_SITIO_IMAGEN', { default: '' }),
  /** Cuenta de servicio del build (nombre corto o correo). Obligatoria solo en modo `google`. */
  constructorSitioCuenta: defineString('CONSTRUCTOR_SITIO_CUENTA', { default: '' }),
  /**
   * Cuenta de servicio PROPIA de las funciones que lanzan y consultan builds (`construirSitio`, `avisoConstruccionSitio`): es la única
   * con permiso de crear builds y de actuar como `sitio-constructor`, y la única que lee `SITIOS_TENANT`. Vacío = la cuenta por defecto.
   */
  cuentaFnConstructor: defineString('CUENTA_FN_CONSTRUCTOR_SITIO', { default: '' }),
  /** `APP_ENV` del script del constructor (`staging` o `production`). */
  constructorSitioAppEnv: defineString('CONSTRUCTOR_SITIO_APP_ENV', { default: 'staging' }),
  /** Máquina de Cloud Build (`options.machineType`); vacío = la del grupo regional por defecto. */
  constructorSitioMaquina: defineString('CONSTRUCTOR_SITIO_MAQUINA', { default: '' }),
  /** Configuración web pública del sitio que compila el build (valores públicos, como en el workflow). Obligatorias solo en modo `google`. */
  viteFirebaseApiKey: defineString('VITE_FIREBASE_API_KEY', { default: '' }),
  viteFirebaseAppId: defineString('VITE_FIREBASE_APP_ID', { default: '' }),
  viteRecaptchaSitio: defineString('VITE_RECAPTCHA_ENTERPRISE_SITE_KEY', { default: '' }),
  /** Sitio de Hosting del panel: el script del constructor nunca despliega sobre él. (No puede llamarse `FIREBASE_*`: prefijo reservado.) */
  sitioPanelId: defineString('SITIO_PANEL_ID', { default: '' }),
} as const;

export const SECRETOS = {
  /** Secreto HMAC del pedido firmado de NovuChat. */
  pedidos: defineSecret('NOVUCHAT_PEDIDOS_SECRETO'),
  /** Secreto HMAC del endpoint de reconstrucción del sitio (GitHub Actions). */
  reconstruccion: defineSecret('SITIO_RECONSTRUCCION_SECRETO'),
  /** Sal del hash de las claves del límite de tasa (para que la colección no revele IP). Obligatoria fuera de las pruebas. */
  salLimite: defineSecret('LIMITE_TASA_SAL'),
  /**
   * Token de grano fino de GitHub (un solo repositorio, solo «Actions» de escritura, vence a los 90 días; DS-3) para avisar a
   * Actions. Vinculado SOLO a `temporizadorSitio`. Vacío o con forma inválida = disparo deshabilitado.
   */
  disparoSitio: defineSecret('GITHUB_DISPARO_SITIO'),
} as const;

/** Entero positivo de un parámetro de texto; si no es válido, el valor por defecto. */
export function enteroDe(valor: string, defecto: number): number {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : defecto;
}

export class ConfiguracionIncompleta extends Error {
  constructor(faltan: readonly string[]) {
    super(`Configuración incompleta de las funciones: falta ${faltan.join(', ')}`);
    this.name = 'ConfiguracionIncompleta';
  }
}

/**
 * Valores que NO pueden faltar fuera del emulador y de las pruebas: la sal del límite de tasa (sin ella los hashes de las
 * IP serían reversibles por diccionario) y la base pública de los medios (sin valor por defecto al bucket por defecto).
 * Devuelve los valores ya normalizados (sin barra final); en pruebas admite vacíos.
 */
export function exigirConfiguracionDeServicio(
  v: { readonly sal: string; readonly mediosBaseUrl: string },
  esPruebas: boolean,
): { readonly sal: string; readonly mediosBaseUrl: string } {
  const mediosBaseUrl = v.mediosBaseUrl.trim().replace(/\/+$/, '');
  if (!esPruebas) {
    const faltan: string[] = [];
    if (v.sal === '') faltan.push('LIMITE_TASA_SAL');
    if (!/^https:\/\/[^\s/]+/.test(mediosBaseUrl)) faltan.push('MEDIOS_BASE_URL (URL https)');
    if (faltan.length > 0) throw new ConfiguracionIncompleta(faltan);
  }
  return { sal: v.sal === '' ? 'sal-de-pruebas' : v.sal, mediosBaseUrl };
}

const NOMBRE_BUCKET = /^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/;

/**
 * Nombre del bucket público de los medios. Fuera de pruebas es obligatorio, de nombre válido y distinto del bucket por
 * defecto (el de originales y recibos). En pruebas, vacío = el bucket por defecto (devuelve `''`).
 */
export function exigirBucketPublico(valor: string, bucketPorDefecto: string, esPruebas: boolean): string {
  const nombre = valor.trim();
  if (esPruebas) return nombre;
  if (nombre === '') throw new ConfiguracionIncompleta(['MEDIOS_BUCKET_PUBLICO']);
  if (!NOMBRE_BUCKET.test(nombre)) throw new ConfiguracionIncompleta(['MEDIOS_BUCKET_PUBLICO (nombre de bucket válido)']);
  if (nombre === bucketPorDefecto) throw new ConfiguracionIncompleta(['MEDIOS_BUCKET_PUBLICO (distinto del bucket por defecto)']);
  return nombre;
}

export type ModoConstructorSitio = 'github' | 'google';

/** Solo el valor exacto `google` activa Cloud Build; cualquier otro (vacío, mayúsculas, errata) deja el modo `github`. */
export function modoConstructorSitio(valor: string): ModoConstructorSitio {
  return valor.trim() === 'google' ? 'google' : 'github';
}

export interface ConfiguracionConstructorSitio {
  readonly proyecto: string;
  readonly imagen: string;
  readonly cuentaServicio: string;
  readonly maquina: string | undefined;
  /** Variables públicas del build; solo las que `reconstruir-sitio.sh` lee. */
  readonly entorno: Readonly<Record<string, string>>;
}

/** Valida lo que exige el modo `google` y arma lo del conector. Falla cerrado listando los nombres que faltan (nunca valores). */
export function exigirConfiguracionConstructor(v: {
  readonly proyecto: string; readonly imagen: string; readonly cuenta: string; readonly cuentaFn: string; readonly maquina: string; readonly appEnv: string;
  readonly apiKey: string; readonly appId: string; readonly recaptcha: string; readonly panel: string; readonly mediosBaseUrl: string;
}): ConfiguracionConstructorSitio {
  const t = (x: string): string => x.trim();
  const faltan: string[] = [];
  if (t(v.proyecto) === '') faltan.push('proyecto (GCLOUD_PROJECT)');
  if (t(v.imagen) === '') faltan.push('CONSTRUCTOR_SITIO_IMAGEN');
  if (t(v.cuenta) === '') faltan.push('CONSTRUCTOR_SITIO_CUENTA');
  // Las funciones del constructor nunca deben correr con la cuenta general (es la única con permiso de crear builds y leer SITIOS_TENANT).
  if (t(v.cuentaFn) === '') faltan.push('CUENTA_FN_CONSTRUCTOR_SITIO');
  if (t(v.apiKey) === '') faltan.push('VITE_FIREBASE_API_KEY');
  if (t(v.appId) === '') faltan.push('VITE_FIREBASE_APP_ID');
  if (t(v.recaptcha) === '') faltan.push('VITE_RECAPTCHA_ENTERPRISE_SITE_KEY');
  if (t(v.panel) === '') faltan.push('SITIO_PANEL_ID');
  if (t(v.mediosBaseUrl) === '') faltan.push('MEDIOS_BASE_URL');
  if (t(v.appEnv) !== 'staging' && t(v.appEnv) !== 'production') faltan.push('CONSTRUCTOR_SITIO_APP_ENV (staging o production)');
  if (faltan.length > 0) throw new ConfiguracionIncompleta(faltan);
  return {
    proyecto: t(v.proyecto), imagen: t(v.imagen), cuentaServicio: t(v.cuenta), maquina: t(v.maquina) === '' ? undefined : t(v.maquina),
    entorno: {
      VITE_FIREBASE_PROJECT_ID: t(v.proyecto), VITE_FIREBASE_API_KEY: t(v.apiKey), VITE_FIREBASE_APP_ID: t(v.appId),
      VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: t(v.recaptcha), MEDIOS_BASE_URL: t(v.mediosBaseUrl), SITIOS_PROHIBIDOS: t(v.panel), APP_ENV: t(v.appEnv),
    },
  };
}
