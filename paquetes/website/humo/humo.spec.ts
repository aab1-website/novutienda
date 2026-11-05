import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { DOMINIOS_DE_MEDICION, decidirConsentimiento, simularApi, vigilar } from './comun.js';

const PAGINAS = ['/', '/404', '/productos', '/productos/televisores', '/producto/televisor-ejemplo-55', '/contacto', '/privacidad', '/seccion/como-comprar'];
const PLANTILLAS = ['cielo', 'bosque', 'ambar', 'grafito', 'ciruela'] as const;
/** Las islas `load` e `idle` ya están listas (las `visible` se hidratan al llegar a la pantalla). */
const islasListas = (page: Page): Promise<unknown> => page.waitForFunction(() => document.querySelectorAll('astro-island[ssr][client="load"], astro-island[ssr][client="idle"]').length === 0);
/** Lleva el elemento a la pantalla y espera a que sus islas se hidraten. */
async function hidratar(el: Locator): Promise<void> {
  await el.scrollIntoViewIfNeeded();
  await expect(el.locator('astro-island[ssr]')).toHaveCount(0);
}
const hostPropio = (u: string): boolean => /^(http:\/\/127\.0\.0\.1|data:|blob:)/.test(u);

test.describe('CSP y peticiones', () => {
  for (const ruta of PAGINAS) {
    test(`${ruta}: sin errores de consola, sin violaciones de CSP y sin peticiones externas`, async ({ page }) => {
      await simularApi(page);
      const v = vigilar(page);
      await decidirConsentimiento(page, false, false);
      await page.goto(ruta);
      await page.waitForLoadState('networkidle');
      expect(v.errores).toEqual([]);
      expect(v.peticiones.filter((u) => !hostPropio(u))).toEqual([]);
    });
  }

  test('sin decidir (primera visita) tampoco hay peticiones a Google, Meta ni TikTok, aunque se recorra el sitio', async ({ page }) => {
    await simularApi(page);
    const v = vigilar(page);
    for (const ruta of ['/', '/producto/televisor-ejemplo-55', '/contacto']) {
      await page.goto(ruta);
      await page.waitForLoadState('networkidle');
    }
    expect(v.peticiones.filter((u) => DOMINIOS_DE_MEDICION.test(u))).toEqual([]);
    await expect(page.getByRole('dialog', { name: 'Cookies y medición' })).toBeVisible();
  });

  test('«Solo lo necesario» guarda la decisión y no carga nada', async ({ page }) => {
    await simularApi(page);
    const v = vigilar(page);
    await page.goto('/');
    await islasListas(page);
    await page.getByRole('button', { name: 'Solo lo necesario' }).click();
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('dialog', { name: 'Cookies y medición' })).toHaveCount(0);
    expect(v.peticiones.filter((u) => DOMINIOS_DE_MEDICION.test(u))).toEqual([]);
  });

  test('«Aceptar todo» carga Google, Meta y TikTok, y los eventos de la ficha y del botón Comprar se envían', async ({ page }) => {
    await simularApi(page);
    await page.addInitScript(() => localStorage.setItem('cb.mercado', 'BO'));
    const pedidas: string[] = [];
    for (const patron of ['**/*googletagmanager.com/**', '**/*connect.facebook.net/**', '**/*analytics.tiktok.com/**']) {
      await page.route(patron, (r) => { pedidas.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }); });
    }
    await page.goto('/producto/televisor-ejemplo-55');
    await islasListas(page);
    await page.getByRole('button', { name: 'Aceptar todo' }).click();
    await page.waitForLoadState('networkidle');
    const hosts = pedidas.map((u) => new URL(u));
    expect(hosts.some((u) => u.hostname === 'www.googletagmanager.com' && u.pathname === '/gtag/js' && u.searchParams.get('id') === 'G-EJEMPLO00')).toBe(true);
    expect(hosts.some((u) => u.hostname === 'connect.facebook.net')).toBe(true);
    expect(hosts.some((u) => u.hostname === 'analytics.tiktok.com')).toBe(true);
    await page.evaluate(() => document.querySelector('a[href^="https://wa.me/"]')?.addEventListener('click', (e) => e.preventDefault()));
    await page.getByRole('link', { name: 'COMPRAR', exact: true }).click();
    const comandos = await page.evaluate(() => (window as unknown as { dataLayer: ArrayLike<unknown>[] }).dataLayer.map((a) => Array.from(a)[1]));
    expect(comandos).toContain('clic_comprar');
    expect(comandos).toContain('update');
  });
});

test.describe('precio, país y compra', () => {
  test('el precio sale de la cotización del API con precioFinal; precio 0 dice «Consultar»', async ({ page }) => {
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    await page.goto('/productos/televisores');
    const t55 = page.locator('[data-producto-id="ejemplo-tv-55"]');
    await hidratar(t55);
    await hidratar(page.locator('[data-producto-id="ejemplo-tv-65"]'));
    await expect(t55.locator('.precio-valor')).toHaveText('Bs 4.500');
    await expect(page.locator('[data-producto-id="ejemplo-tv-65"] .precio-valor')).toHaveText('Consultar');
    await page.getByRole('button', { name: 'Ver precios en pesos argentinos' }).click();
    await expect(t55.locator('.precio-valor')).toHaveText('$ 480.000');
  });

  test('sin cotización utilizable no se inventa ningún precio', async ({ page }) => {
    await simularApi(page, { sinCotizacion: true });
    await decidirConsentimiento(page, false, false);
    await page.goto('/productos/televisores');
    await hidratar(page.locator('[data-producto-id="ejemplo-tv-55"]'));
    await expect(page.locator('[data-producto-id="ejemplo-tv-55"] .precio-valor')).toContainText('Precio no disponible');
    await expect(page.locator('[data-producto-id="ejemplo-tv-55"] .precio-valor')).not.toContainText('Bs');
  });

  test('ventana de país en la primera visita: role=dialog, foco atrapado, Escape y elección recordada', async ({ page }) => {
    await simularApi(page);
    await page.addInitScript(() => localStorage.setItem('cb.consentimiento', JSON.stringify({ v: 1, analitica: false, marketing: false })));
    await page.goto('/');
    const dlg = page.getByRole('dialog', { name: '¿Desde dónde nos visitas?' });
    await expect(dlg).toBeVisible();
    await expect(dlg).toHaveAttribute('aria-modal', 'true');
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab');
      expect(await dlg.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await dlg.getByRole('button', { name: /Argentina/ }).click();
    await expect(dlg).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('dialog', { name: '¿Desde dónde nos visitas?' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ver precios en pesos argentinos' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('Escape cierra la ventana y devuelve el foco al botón que la abrió', async ({ page }) => {
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    await page.goto('/');
    await islasListas(page);
    const abrir = page.getByRole('button', { name: 'Buscar productos' });
    await abrir.focus();
    await page.keyboard.press('Enter');
    const dlg = page.getByRole('dialog', { name: 'Buscar productos' });
    await expect(dlg).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await expect(abrir).toBeFocused();
  });

  test('«Comprar» abre wa.me con el mensaje «Hola, quiero comprar: nombre (cód. id)» y el número de la configuración', async ({ page }) => {
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    await page.goto('/producto/televisor-ejemplo-55');
    const enlace = page.getByRole('link', { name: 'COMPRAR', exact: true });
    const href = (await enlace.getAttribute('href')) ?? '';
    const url = new URL(href);
    expect(url.origin + url.pathname).toBe('https://wa.me/59100000001');
    expect(url.searchParams.get('text')).toBe('Hola, quiero comprar: Televisor de ejemplo 55" (cód. ejemplo-tv-55)');
    await expect(enlace).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(enlace).toHaveAttribute('target', '_blank');
  });

  test('un producto agotado (según la API) no muestra botones', async ({ page }) => {
    await simularApi(page);
    await page.route('**/api/disponibilidad*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ disponibilidad: { 'ejemplo-tv-55': 'agotado' } }) }));
    await decidirConsentimiento(page, false, false);
    await page.goto('/producto/televisor-ejemplo-55');
    await expect(page.getByText('TEMPORALMENTE AGOTADO')).toBeVisible();
    await expect(page.getByRole('link', { name: 'COMPRAR', exact: true })).toHaveCount(0);
  });

  test('carrito de consulta: agregar, cambiar cantidad y enviar por WhatsApp', async ({ page }) => {
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    await page.goto('/productos/lavadoras');
    const lavadora = page.locator('[data-producto-id="ejemplo-lavadora-9"]');
    await hidratar(lavadora);
    await islasListas(page);
    await lavadora.getByRole('button', { name: 'AGREGAR' }).click();
    await page.getByRole('button', { name: /Carrito de consulta, 1 producto/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Mi carrito de consulta' });
    await dlg.getByRole('button', { name: /Agregar una unidad/ }).click();
    const wa = dlg.getByRole('link', { name: /CONSULTAR POR WHATSAPP/ });
    const texto = new URL((await wa.getAttribute('href')) ?? '').searchParams.get('text');
    expect(texto).toContain('2 x Lavadora de ejemplo 9 kg (cód. ejemplo-lavadora-9)');
  });

  test('buscador y filtros por marca y precio', async ({ page }) => {
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    await page.goto('/productos');
    await islasListas(page);
    await page.getByRole('button', { name: 'Buscar productos' }).click();
    await page.getByRole('searchbox').fill('lavadora nordika');
    await expect(page.getByRole('dialog').getByRole('link')).toHaveCount(1);
    await page.keyboard.press('Escape');
    const todas = page.locator('[data-producto-id]');
    const total = await todas.count();
    await page.getByRole('checkbox', { name: 'Aurora' }).check();
    await expect(page.locator('[data-producto-id]:not([hidden])')).toHaveCount(3);
    await page.getByRole('checkbox', { name: 'Aurora' }).uncheck();
    await page.getByLabel('Hasta').fill('3000');
    await expect(page.locator('[data-producto-id]:not([hidden])')).not.toHaveCount(total);
    await expect(page.locator('[data-producto-id="ejemplo-tv-65"]')).toBeHidden();
  });

  test('convertidor: usa la cotización, sin tasas en el código', async ({ page }) => {
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    await page.goto('/');
    await islasListas(page);
    await page.getByRole('button', { name: 'Convertidor de precios' }).click();
    const dlg = page.getByRole('dialog', { name: 'Convertidor de precios' });
    await dlg.getByLabel('Dólares (US$)').fill('2');
    await expect(dlg.getByLabel('Bolivianos (Bs)')).toHaveValue('20');
    await expect(dlg.getByLabel('Pesos argentinos ($)')).toHaveValue(/2[.,]?000/);
  });
});

test.describe('ficha, tema y formulario', () => {
  test('ficha: hasta 5 fotos y 1 video con preload none, garantía y JSON-LD Product/Offer', async ({ page }) => {
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    await page.goto('/producto/televisor-ejemplo-55');
    await islasListas(page);
    await expect(page.locator('h1')).toHaveText('Televisor de ejemplo 55"');
    await expect(page.locator('.miniatura')).toHaveCount(4);
    await page.getByRole('button', { name: /Ver video/ }).click();
    const video = page.locator('video');
    await expect(video).toHaveAttribute('preload', 'none');
    await expect(page.getByText('Garantía: 12 meses (ejemplo)')).toBeVisible();
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent()) ?? '{}') as { '@type': string; offers: { price: string; priceCurrency: string }[] };
    expect(ld['@type']).toBe('Product');
    expect(ld.offers[0]).toMatchObject({ price: '450.00', priceCurrency: 'USD' });
  });

  test('el tema sigue al dispositivo, se puede cambiar y se recuerda', async ({ page }) => {
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.goto('/');
    await islasListas(page);
    const fondo = (): Promise<string> => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(await fondo()).toBe('rgb(0, 0, 0)');
    await page.getByRole('button', { name: 'Cambiar a modo día' }).click();
    expect(await fondo()).toBe('rgb(244, 246, 249)');
    await page.reload();
    expect(await fondo()).toBe('rgb(244, 246, 249)');
    await expect(page.locator('html')).toHaveAttribute('data-tema', 'claro');
  });

  test('formulario: valida en el navegador, anuncia los errores y no envía nada con datos inválidos', async ({ page }) => {
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    const posts: string[] = [];
    page.on('request', (r) => r.method() === 'POST' && posts.push(r.url()));
    await page.goto('/contacto');
    await islasListas(page);
    await page.getByRole('button', { name: /ENVIAR MENSAJE/ }).click();
    const alerta = page.getByRole('alert');
    await expect(alerta).toContainText('Revisa los campos marcados');
    await expect(alerta).toContainText('Nombre');
    expect(posts).toEqual([]);
  });

  test('formulario: envío válido con reCAPTCHA simulado y clave de idempotencia estable', async ({ page }) => {
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    await simularRecaptchaYAppCheck(page);
    const cuerpos: Record<string, unknown>[] = [];
    await page.route('**/api/contacto', async (r) => {
      cuerpos.push(r.request().postDataJSON() as Record<string, unknown>);
      await r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
    await page.goto('/contacto');
    await islasListas(page);
    await page.getByLabel('Nombre', { exact: true }).fill('Ana Pérez');
    await page.getByLabel('Correo electrónico').fill('ana@ejemplo.invalid');
    await page.getByLabel('Mensaje').fill('Quisiera saber el precio.');
    await page.getByLabel(/Acepto/).check();
    await page.getByRole('button', { name: /ENVIAR MENSAJE/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Recibimos tu mensaje' })).toBeVisible();
    expect(cuerpos).toHaveLength(1);
    expect(cuerpos[0]).toMatchObject({ nombre: 'Ana Pérez', aceptaPrivacidad: true, sitioWeb: '' });
    expect(String(cuerpos[0]?.['envioId'])).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });

  test('formulario: App Check de un solo uso, con el SDK real y el intercambio simulado, sin violaciones de CSP', async ({ page }) => {
    const { errores } = vigilar(page);
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    const intercambios = await simularRecaptchaYAppCheck(page);
    const cabeceras: (string | undefined)[] = [];
    await page.route('**/api/contacto', async (r) => {
      cabeceras.push(r.request().headers()['x-firebase-appcheck']);
      await r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
    await page.goto('/contacto');
    await islasListas(page);
    expect(await page.evaluate(() => typeof (window as unknown as { cbAppCheck?: unknown }).cbAppCheck)).toBe('function');
    for (let i = 0; i < 2; i += 1) {
      await page.getByLabel('Nombre', { exact: true }).fill('Ana Pérez');
      await page.getByLabel('Correo electrónico').fill('ana@ejemplo.invalid');
      await page.getByLabel('Mensaje').fill('Quisiera saber el precio.');
      await page.getByLabel(/Acepto/).check();
      await page.getByRole('button', { name: /ENVIAR MENSAJE/ }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Recibimos tu mensaje' })).toBeVisible();
    }
    expect(cabeceras).toHaveLength(2);
    expect(cabeceras[0]).toMatch(/^token-appcheck-\d+$/);
    expect(cabeceras[1]).toMatch(/^token-appcheck-\d+$/);
    expect(cabeceras[1]).not.toBe(cabeceras[0]);
    expect(intercambios.limitados).toBeGreaterThanOrEqual(2);
    expect(errores).toEqual([]);
  });

  test('el sitio no tiene ingreso de administración ni chat simulado, ni voseo', async ({ page }) => {
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    await page.goto('/');
    const texto = (await page.locator('body').innerText()).toLowerCase();
    expect(texto).not.toMatch(/panel de administraci|iniciar sesi|contraseña|escribe un mensaje/);
    expect(texto).not.toMatch(/\b(tenés|querés|seleccioná|conocé|explorá|comunicate|coordiná|podés)\b/);
    expect(texto).not.toContain('+5,000');
    expect(texto).not.toContain('100% originales');
  });
});

async function auditar(page: Page, etiqueta: string): Promise<void> {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const graves = r.violations.map((v) => `${etiqueta}: ${v.id} (${v.impact}) ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  expect(graves).toEqual([]);
}

test.describe('accesibilidad (axe) en claro y oscuro con las 5 plantillas', () => {
  for (const plantilla of PLANTILLAS) {
    for (const tema of ['claro', 'oscuro'] as const) {
      test(`${plantilla} / ${tema}`, async ({ page }) => {
        // Sin transiciones: axe mediría colores a mitad de camino al cambiar de tema.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await simularApi(page);
        await decidirConsentimiento(page, false, false);
        for (const ruta of ['/', '/productos/televisores', '/producto/televisor-ejemplo-55', '/contacto']) {
          await page.goto(ruta);
          await page.waitForLoadState('networkidle');
          await page.evaluate(([p, t]) => {
            document.documentElement.dataset['plantilla'] = p;
            document.documentElement.dataset['tema'] = t;
          }, [plantilla, tema] as const);
          await auditar(page, `${plantilla}/${tema}${ruta}`);
        }
      });
    }
  }

  test('con el aviso de cookies y la ventana de país abiertos', async ({ page }) => {
    await simularApi(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.getByRole('dialog', { name: '¿Desde dónde nos visitas?' }).waitFor();
    await auditar(page, 'ventana-pais');
    await page.getByRole('button', { name: /Bolivia/ }).click();
    await page.getByRole('dialog', { name: 'Cookies y medición' }).waitFor();
    await auditar(page, 'cookies');
    await page.getByRole('button', { name: 'Personalizar' }).click();
    await auditar(page, 'cookies-detalle');
  });

  test('con el carrito, el buscador y el convertidor abiertos', async ({ page }) => {
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    await page.goto('/');
    await islasListas(page);
    await page.getByRole('button', { name: /Carrito de consulta/ }).click();
    await auditar(page, 'carrito-vacio');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Buscar productos' }).click();
    await auditar(page, 'buscador');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Convertidor de precios' }).click();
    await auditar(page, 'convertidor');
  });
});

/**
 * reCAPTCHA Enterprise simulado (el mismo script sirve al antiabuso y al proveedor de App Check) y el intercambio de App Check de
 * Firebase simulado: devuelve un token distinto por llamada. Cuenta los intercambios de uso limitado.
 */
async function simularRecaptchaYAppCheck(page: Page): Promise<{ limitados: number }> {
  const cuenta = { limitados: 0 };
  let n = 0;
  await page.route('**/recaptcha/enterprise.js*', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.grecaptcha={enterprise:{ready:function(f){f()},render:function(c,o){window.cbCbRecaptcha=o;return 1},execute:function(w){if(w===1&&window.cbCbRecaptcha)window.cbCbRecaptcha.callback();return Promise.resolve("t".repeat(40))}}};' }));
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
  await page.route('https://content-firebaseappcheck.googleapis.com/**', async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    const cuerpo = r.request().postDataJSON() as { limited_use?: boolean; limitedUse?: boolean } | null;
    if (cuerpo?.limited_use === true || cuerpo?.limitedUse === true) cuenta.limitados += 1;
    n += 1;
    return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ token: `token-appcheck-${n}`, ttl: '3600s' }) });
  });
  return cuenta;
}
