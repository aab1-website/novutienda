/**
 * Política de seguridad de contenido (CSP) del sitio. Estricta: sin `unsafe-inline` ni
 * `unsafe-eval`, sin CDN. Los únicos orígenes externos son los de los proveedores que el
 * sitio tenga CONFIGURADOS (medición, reCAPTCHA) y, si existe, el origen de medios propio.
 * Los scripts en línea que genera Astro (arranque de las islas) se autorizan por hash:
 * el sellado los calcula tras cada build, así que no pueden quedar desactualizados.
 */
import type { ConfigMedicion } from '../contenido/tipos.js';

export interface OpcionesCsp {
  /** Hashes `'sha256-…'` de los scripts en línea del build. */
  readonly hashesScript: readonly string[];
  readonly medicion: ConfigMedicion;
  readonly recaptcha: boolean;
  readonly origenMedios: string | null;
}

export function construirCsp(o: OpcionesCsp): string {
  const g = o.medicion.google !== null;
  const m = o.medicion.meta !== null;
  const t = o.medicion.tiktok !== null;
  const dir = (nombre: string, ...valores: (string | false | null | readonly string[])[]): string =>
    [nombre, ...valores.flat().filter((v): v is string => typeof v === 'string')].join(' ');
  const medios = o.origenMedios;

  return [
    "default-src 'none'",
    dir('script-src', "'self'", ...o.hashesScript,
      g && 'https://www.googletagmanager.com',
      m && 'https://connect.facebook.net',
      t && 'https://analytics.tiktok.com',
      o.recaptcha && ['https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/']),
    "style-src 'self'",
    dir('img-src', "'self'", 'data:', medios,
      g && ['https://www.googletagmanager.com', 'https://www.google-analytics.com', 'https://*.google-analytics.com'],
      m && 'https://www.facebook.com',
      t && 'https://analytics.tiktok.com',
      o.recaptcha && 'https://www.gstatic.com'),
    dir('media-src', "'self'", medios),
    "font-src 'self'",
    dir('connect-src', "'self'",
      g && ['https://www.google-analytics.com', 'https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://www.googletagmanager.com'],
      m && ['https://www.facebook.com', 'https://connect.facebook.net'],
      t && 'https://analytics.tiktok.com',
      o.recaptcha && 'https://www.google.com'),
    o.recaptcha ? 'frame-src https://www.google.com https://recaptcha.google.com' : "frame-src 'none'",
    "manifest-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

/** Cabeceras que acompañan a la CSP (formato de `firebase.json`). */
export function cabecerasSeguridad(csp: string): readonly { readonly key: string; readonly value: string }[] {
  return [
    { key: 'Content-Security-Policy', value: csp },
    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'geolocation=(), camera=(), microphone=(), payment=(), usb=()' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ];
}
