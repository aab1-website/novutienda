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
} as const;

export const SECRETOS = {
  /** Secreto HMAC del pedido firmado de NovuChat. */
  pedidos: defineSecret('NOVUCHAT_PEDIDOS_SECRETO'),
  /** Secreto HMAC del endpoint de reconstrucción del sitio (GitHub Actions). */
  reconstruccion: defineSecret('SITIO_RECONSTRUCCION_SECRETO'),
  /** Sal del hash de las claves del límite de tasa (para que la colección no revele IP). Obligatoria fuera de las pruebas. */
  salLimite: defineSecret('LIMITE_TASA_SAL'),
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
