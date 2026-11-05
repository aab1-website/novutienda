import type { Page, Route } from '@playwright/test';

/** Cotizaciones INVENTADAS solo para las pruebas (la API real no se consulta). */
export const COTIZACIONES_PRUEBA = {
  cotizaciones: {
    BO: { cotizacionId: 'BO-prueba', par: 'BOB/USD', valor: 10, fecha: '2026-11-04', fuente: 'BCB', estado: 'vigente' },
    AR: { cotizacionId: 'AR-prueba', par: 'ARS/USD', valor: 1000, fecha: '2026-11-04', fuente: 'BNA', estado: 'vigente' },
  },
};

export const DOMINIOS_DE_MEDICION = /(googletagmanager|google-analytics|analytics\.google|facebook|fbcdn|tiktok|gstatic|google\.com)/i;

export async function simularApi(page: Page, opciones: { sinCotizacion?: boolean } = {}): Promise<void> {
  await page.route('**/api/cotizacion*', (r: Route) =>
    opciones.sinCotizacion === true
      ? r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'sin_cotizacion' }) })
      : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(COTIZACIONES_PRUEBA) }),
  );
  await page.route('**/api/disponibilidad*', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ disponibilidad: {} }) }));
}

/** Registra violaciones de CSP y errores de consola/página. */
export function vigilar(page: Page): { errores: string[]; peticiones: string[] } {
  const errores: string[] = [];
  const peticiones: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || /Content.Security.Policy|Refused to/i.test(m.text())) errores.push(`consola: ${m.text()}`);
  });
  page.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`));
  page.on('request', (r) => peticiones.push(r.url()));
  return { errores, peticiones };
}

export const decidirConsentimiento = (page: Page, analitica: boolean, marketing: boolean): Promise<void> =>
  page.addInitScript(([a, m]) => {
    localStorage.setItem('cb.consentimiento', JSON.stringify({ v: 1, analitica: a, marketing: m }));
    localStorage.setItem('cb.mercado', 'BO');
  }, [analitica, marketing] as const);
