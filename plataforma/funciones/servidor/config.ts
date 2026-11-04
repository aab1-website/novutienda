// Configuración de las funciones. Nada de identificadores del proyecto ni de secretos en el repositorio:
// los valores salen de parámetros de despliegue (`.env.<alias>` o variables) y de Secret Manager.
// `.value()` solo se llama dentro de un manejador, nunca al cargar el módulo.
import { defineBoolean, defineSecret, defineString } from 'firebase-functions/params';

export const REGION = 'us-east1';

export const PARAMETROS = {
  /** Tenant que atiende esta instalación en las rutas públicas y firmadas sin token de usuario. */
  tenantId: defineString('TENANT_ID', { default: 'casa-bermejo' }),
  /** `true` en producción: rechaza llamadas sin token de App Check válido. */
  appCheckExigido: defineBoolean('APP_CHECK_EXIGIDO', { default: false }),
  /** `real` (reCAPTCHA Enterprise) o `simulado` (solo emulador y pruebas). */
  recaptchaModo: defineString('RECAPTCHA_MODO', { default: 'real' }),
  recaptchaClaveSitio: defineString('RECAPTCHA_CLAVE_SITIO', { default: '' }),
  /** `real` (Admin App Check) o `simulado` (solo emulador y pruebas). */
  appCheckModo: defineString('APP_CHECK_MODO', { default: 'real' }),
  /** URL pública del sitio (para `urlProducto` del catálogo), sin barra final. */
  sitioUrl: defineString('SITIO_URL', { default: '' }),
  /** Base pública de los medios (hosting o CDN); vacío = `https://storage.googleapis.com/<bucket>`. */
  mediosBaseUrl: defineString('MEDIOS_BASE_URL', { default: '' }),
  /** Binarios de video (opcionales: sin ellos el video se rechaza con un error claro). */
  ffmpegPath: defineString('FFMPEG_PATH', { default: '' }),
  ffprobePath: defineString('FFPROBE_PATH', { default: '' }),
  /** Peticiones por ventana al formulario de contacto, por origen. */
  contactoMaximo: defineString('CONTACTO_MAXIMO', { default: '5' }),
  contactoVentanaSeg: defineString('CONTACTO_VENTANA_SEG', { default: '600' }),
  /** Peticiones por minuto a la API de NovuChat, por token. */
  novuchatMaximoPorMinuto: defineString('NOVUCHAT_MAXIMO_POR_MINUTO', { default: '120' }),
} as const;

export const SECRETOS = {
  /** Secreto HMAC del pedido firmado de NovuChat. */
  pedidos: defineSecret('NOVUCHAT_PEDIDOS_SECRETO'),
  /** Secreto HMAC del endpoint de reconstrucción del sitio (GitHub Actions). */
  reconstruccion: defineSecret('SITIO_RECONSTRUCCION_SECRETO'),
  /** Sal del hash de las claves del límite de tasa (para que la colección no revele IP). */
  salLimite: defineSecret('LIMITE_TASA_SAL'),
} as const;

/** Entero positivo de un parámetro de texto; si no es válido, el valor por defecto. */
export function enteroDe(valor: string, defecto: number): number {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : defecto;
}
