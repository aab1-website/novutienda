/**
 * Medición: Google (Analytics, con Consent Mode v2), píxel de Meta y píxel de TikTok.
 *
 * REGLA DURA: sin consentimiento de la categoría correspondiente no se descarga ni un byte
 * de esos dominios. Lo único que ocurre antes es escribir en memoria el estado «denegado»
 * de Consent Mode (`dataLayer`), que no hace ninguna petición. Los identificadores vienen de
 * la configuración del sitio, nunca del código. Los eventos solo llevan el código y el
 * nombre del producto, jamás datos de contacto.
 */
import type { ConfigMedicion } from '../contenido/tipos.js';
import type { Consentimiento } from './consentimiento.js';

export type NombreEvento = 'vista_producto' | 'clic_comprar' | 'envio_formulario';

export interface DatosEvento {
  readonly id?: string;
  readonly nombre?: string;
}

/** Lo que la medición necesita del entorno; en el navegador son `window` y una función que añade un `<script>`. */
export interface Entorno {
  readonly ventana: Record<string, unknown>;
  cargarScript(src: string): void;
}

type Funcion = (...args: unknown[]) => void;

export const URL_GOOGLE = 'https://www.googletagmanager.com/gtag/js';
export const URL_META = 'https://connect.facebook.net/en_US/fbevents.js';
export const URL_TIKTOK = 'https://analytics.tiktok.com/i18n/pixel/events.js';

const METODOS_TIKTOK = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie', 'holdConsent', 'revokeConsent', 'grantConsent'] as const;

export interface Medicion {
  /** Prepara el estado «denegado» (sin peticiones) y aplica la decisión guardada, si la hay. */
  iniciar(decision: Consentimiento | null): void;
  /** Aplica una decisión nueva. Cargar es irreversible hasta recargar; revocar vuelve a «denegado». */
  aplicar(decision: Consentimiento): void;
  evento(nombre: NombreEvento, datos?: DatosEvento): void;
}

export function crearMedicion(config: ConfigMedicion, entorno: Entorno): Medicion {
  const w = entorno.ventana;
  let googleCargado = false;
  let metaCargado = false;
  let tiktokCargado = false;
  let actual: Consentimiento = { analitica: false, marketing: false };

  function gtag(...args: unknown[]): void {
    void args;
    // gtag.js solo reconoce como comando el objeto `arguments`, no un arreglo.
    // eslint-disable-next-line prefer-rest-params
    ((w['dataLayer'] ??= []) as unknown[]).push(arguments);
  }

  function estadoGoogle(c: Consentimiento): Record<string, string> {
    const m = c.marketing ? 'granted' : 'denied';
    return { ad_storage: m, ad_user_data: m, ad_personalization: m, analytics_storage: c.analitica ? 'granted' : 'denied' };
  }

  function prepararGoogle(): void {
    if (config.google === null) return;
    w['gtag'] ??= gtag as Funcion;
    gtag('consent', 'default', { ...estadoGoogle({ analitica: false, marketing: false }), wait_for_update: 500 });
  }

  function cargarGoogle(): void {
    if (config.google === null || googleCargado) return;
    googleCargado = true;
    gtag('js', new Date());
    gtag('config', config.google, { anonymize_ip: true, allow_ad_personalization_signals: false });
    entorno.cargarScript(`${URL_GOOGLE}?id=${encodeURIComponent(config.google)}`);
  }

  function cargarMeta(): void {
    if (config.meta === null || metaCargado) return;
    metaCargado = true;
    const cola: unknown[] = [];
    const fbq = ((...args: unknown[]): void => {
      const llamar = (fbq as unknown as { callMethod?: Funcion }).callMethod;
      if (llamar !== undefined) llamar(...args);
      else cola.push(args);
    }) as Funcion & { queue?: unknown[]; loaded?: boolean; version?: string };
    fbq.queue = cola;
    fbq.loaded = true;
    fbq.version = '2.0';
    w['fbq'] = fbq;
    w['_fbq'] = fbq;
    fbq('consent', 'grant');
    fbq('init', config.meta);
    fbq('track', 'PageView');
    entorno.cargarScript(URL_META);
  }

  function cargarTiktok(): void {
    if (config.tiktok === null || tiktokCargado) return;
    tiktokCargado = true;
    const ttq = ((w['ttq'] as unknown[] | undefined) ?? []) as unknown[] & Record<string, unknown>;
    w['TiktokAnalyticsObject'] = 'ttq';
    w['ttq'] = ttq;
    const diferir = (objetivo: Record<string, unknown>, metodo: string): void => {
      objetivo[metodo] = (...args: unknown[]): void => {
        (objetivo as unknown as unknown[]).push([metodo, ...args]);
      };
    };
    for (const m of METODOS_TIKTOK) diferir(ttq, m);
    ttq['instance'] = (id: string): unknown[] => {
      const inst = (((ttq['_i'] as Record<string, unknown[]> | undefined) ?? {})[id] ?? []) as unknown[] & Record<string, unknown>;
      for (const m of METODOS_TIKTOK) diferir(inst, m);
      return inst;
    };
    ttq['_i'] = { [config.tiktok]: [] };
    ttq['_t'] = { [config.tiktok]: Date.now() };
    ttq['_o'] = { [config.tiktok]: {} };
    entorno.cargarScript(`${URL_TIKTOK}?sdkid=${encodeURIComponent(config.tiktok)}&lib=ttq`);
    (ttq['page'] as Funcion)();
  }

  function aplicar(c: Consentimiento): void {
    actual = c;
    if (config.google !== null) {
      if (c.analitica || c.marketing) {
        gtag('consent', 'update', estadoGoogle(c));
        cargarGoogle();
      } else if (googleCargado) {
        gtag('consent', 'update', estadoGoogle(c));
      }
    }
    if (c.marketing) {
      cargarMeta();
      cargarTiktok();
    } else {
      if (metaCargado) (w['fbq'] as Funcion)('consent', 'revoke');
      if (tiktokCargado) (w['ttq'] as { revokeConsent?: Funcion }).revokeConsent?.();
    }
  }

  function evento(nombre: NombreEvento, datos: DatosEvento = {}): void {
    const items = datos.id === undefined ? [] : [{ item_id: datos.id, item_name: datos.nombre ?? '' }];
    const contenido = datos.id === undefined ? {} : { content_ids: [datos.id], content_name: datos.nombre ?? '', content_type: 'product' };
    if (googleCargado && (actual.analitica || actual.marketing)) {
      const gnombre = { vista_producto: 'view_item', clic_comprar: 'clic_comprar', envio_formulario: 'generate_lead' }[nombre];
      gtag('event', gnombre, items.length > 0 ? { items } : {});
    }
    if (metaCargado && actual.marketing) {
      const m = { vista_producto: 'ViewContent', clic_comprar: 'InitiateCheckout', envio_formulario: 'Lead' }[nombre];
      (w['fbq'] as Funcion)('track', m, contenido);
    }
    if (tiktokCargado && actual.marketing) {
      const t = { vista_producto: 'ViewContent', clic_comprar: 'ClickButton', envio_formulario: 'SubmitForm' }[nombre];
      (w['ttq'] as { track: Funcion }).track(t, contenido);
    }
  }

  return {
    iniciar(decision) {
      prepararGoogle();
      if (decision !== null) aplicar(decision);
    },
    aplicar,
    evento,
  };
}
