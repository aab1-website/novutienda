import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { DOMINIOS_DE_MEDICION, decidirConsentimiento, simularApi, vigilar } from './comun.js';

const PAGINAS = ['/', '/404', '/productos', '/productos/televisores', '/producto/televisor-ejemplo-55', '/contacto', '/privacidad', '/seccion/como-comprar'];
const PLANTILLAS = ['cielo', 'bosque', 'ambar', 'grafito', 'ciruela'] as const;
/** Las islas `load` e `idle` ya están listas (las `visible` se hidratan al llegar a la pantalla). */
const islasListas = (page: Page): Promise<unknown> => page.waitForFunction(() => document.querySelectorAll('astro-island[ssr][client="load"], astro-island[ssr][client="idle"]').length === 0);
/** Tope de la hidratación: en un ejecutor lento del CI bajan una treintena de módulos y las islas tardan más que el 5 s por omisión de `expect`. */
const TOPE_HIDRATACION_MS = 25_000;
/**
 * Lleva el elemento al centro de la pantalla (así todas sus islas quedan visibles) y espera a que se hidraten.
 * Vuelve a centrarlo en cada intento: si el diseño se mueve al cargar fuentes o imágenes, las islas `visible` siguen a la vista.
 */
async function hidratar(el: Locator): Promise<void> {
  await expect(async () => {
    await el.evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await expect(el.locator('astro-island[ssr]')).toHaveCount(0, { timeout: 3_000 });
  }).toPass({ timeout: TOPE_HIDRATACION_MS, intervals: [250, 500, 1_000] });
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
    const v = vigilar(page);
    for (const patron of ['**/*googletagmanager.com/**', '**/*analytics.tiktok.com/**']) {
      await page.route(patron, (r) => { pedidas.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }); });
    }
    // fbevents.js real no sale a internet: este sustituto envía cada `track` de la cola como imagen GET a facebook.com/tr
    // (el camino del píxel real cuando el pedido es corto), para comprobar que la CSP lo permite.
    await page.route('**/*connect.facebook.net/**', (r) => {
      pedidas.push(r.request().url());
      return r.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: "(function(){var q=window.fbq.queue||[];q.forEach(function(a){if(a[0]==='track'){new Image().src='https://www.facebook.com/tr/?ev='+encodeURIComponent(String(a[1]))}})})();",
      });
    });
    await page.route('**/*www.facebook.com/tr*', (r) => r.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAAAAACw=', 'base64') }));
    await page.goto('/producto/televisor-ejemplo-55');
    await islasListas(page);
    await page.getByRole('button', { name: 'Aceptar todo' }).click();
    await page.waitForLoadState('networkidle');
    const hosts = pedidas.map((u) => new URL(u));
    expect(hosts.some((u) => u.hostname === 'www.googletagmanager.com' && u.pathname === '/gtag/js' && u.searchParams.get('id') === 'G-EJEMPLO00')).toBe(true);
    expect(hosts.some((u) => u.hostname === 'connect.facebook.net')).toBe(true);
    expect(hosts.some((u) => u.hostname === 'analytics.tiktok.com')).toBe(true);
    // Meta: la configuración automática se apaga antes de `init`, y al menos un evento llega a facebook.com/tr sin violar la CSP.
    const colaMeta = await page.evaluate(() => ((window as unknown as { fbq: { queue: unknown[][] } }).fbq.queue ?? []).map((c) => Array.from(c).slice(0, 3)));
    const iAuto = colaMeta.findIndex((c) => c[0] === 'set' && c[1] === 'autoConfig' && c[2] === false);
    expect(iAuto).toBeGreaterThanOrEqual(0);
    expect(iAuto).toBeLessThan(colaMeta.findIndex((c) => c[0] === 'init'));
    await expect.poll(() => v.peticiones.filter((u) => u.startsWith('https://www.facebook.com/tr')).length).toBeGreaterThan(0);
    expect(v.errores.filter((e) => /Content.Security.Policy|Refused to/i.test(e))).toEqual([]);
    await page.getByRole('link', { name: 'COMPRAR', exact: true }).click();
    const comandos = await page.evaluate(() => (window as unknown as { dataLayer: ArrayLike<unknown>[] }).dataLayer.map((a) => Array.from(a)[1]));
    expect(comandos).toContain('clic_comprar');
    expect(comandos).toContain('update');
  });
});

test.describe('enlace al mapa', () => {
  test('sin `mapa` en el contenido no aparece «Cómo llegar» ni en contacto ni en el pie', async ({ page }) => {
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    for (const ruta of ['/contacto', '/']) {
      await page.goto(ruta);
      await expect(page.getByRole('link', { name: /Cómo llegar/ })).toHaveCount(0);
    }
  });
});

test.describe('precio, país y compra', () => {
  test('el precio sale de la cotización del API con precioFinal; precio 0 dice «Consultar»', async ({ page }) => {
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    await page.goto('/productos/televisores');
    const t55 = page.locator('[data-producto-id="ejemplo-tv-55"]');
    await hidratar(t55);
    await expect(t55.locator('.precio-valor')).toHaveText('Bs 4.500');
    // El 65" no tiene precio (USD 0) y está sin stock: no se lista, pero su ficha existe y dice «Consultar».
    await expect(page.locator('[data-producto-id="ejemplo-tv-65"]')).toHaveCount(0);
    await page.goto('/producto/televisor-ejemplo-65');
    await expect(page.locator('.precio-valor').first()).toHaveText('Consultar');
    await page.goto('/productos/televisores');
    await hidratar(t55);
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
    // El foco inicial se pone en el mismo efecto que registra Escape: esperarlo evita una carrera.
    await expect(dlg.locator(':focus')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await expect(abrir).toBeFocused();
  });

  test('«Comprar» es un enlace a wa.me sin JavaScript y, ya hidratado, agrega el producto y abre el carrito', async ({ page }) => {
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    await page.goto('/producto/televisor-ejemplo-55');
    const enlace = page.getByRole('link', { name: 'COMPRAR', exact: true });
    const href = new URL((await enlace.getAttribute('href')) ?? '');
    expect(href.origin + href.pathname).toBe('https://wa.me/59100000001');
    expect(href.searchParams.get('text')).toContain('1 x Televisor de ejemplo 55" (cód. ejemplo-tv-55)');
    await islasListas(page);
    await enlace.click();
    const dlg = page.getByRole('dialog', { name: 'Mi pedido' });
    await expect(dlg).toBeVisible();
    const wa = dlg.getByRole('link', { name: /ENVIAR PEDIDO POR WHATSAPP/ });
    const url = new URL((await wa.getAttribute('href')) ?? '');
    expect(url.origin + url.pathname).toBe('https://wa.me/59100000001');
    await expect(wa).toHaveAttribute('href', /Total/);
    const texto = new URL((await wa.getAttribute('href')) ?? '').searchParams.get('text') ?? '';
    expect(texto).toContain('1 x Televisor de ejemplo 55" (cód. ejemplo-tv-55): Bs ');
    expect(texto).toMatch(/Total referencial: Bs /);
  });

  test('sin número configurado, «Comprar» es un botón que agrega y abre el carrito, como «Agregar»', async ({ page }) => {
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    await page.route('**/producto/televisor-ejemplo-55*', async (r) => {
      const resp = await r.fetch();
      await r.fulfill({ response: resp, body: (await resp.text()).replaceAll('59100000001', '12') });
    });
    await page.goto('/producto/televisor-ejemplo-55');
    await islasListas(page);
    await expect(page.getByRole('link', { name: 'COMPRAR', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'COMPRAR', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Mi pedido' })).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('link', { name: /ENVIAR PEDIDO POR WHATSAPP/ })).toHaveCount(0);
  });

  test('barra del celular: siempre visible, solo cantidad, foco de vuelta al cerrar y pie visible', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    await page.goto('/producto/televisor-ejemplo-55');
    await islasListas(page);
    const barra = page.getByRole('region', { name: 'Tu pedido' });
    await expect(barra).toBeInViewport();
    await expect(barra).toContainText('Tu pedido está vacío');
    await page.getByRole('button', { name: 'AGREGAR' }).click();
    await page.getByRole('button', { name: 'AGREGAR' }).click();
    await expect(page.getByText('Ya estaba en tu pedido: ahora 2')).toBeVisible();
    await expect(barra).toContainText('2 productos');
    await expect(barra).not.toContainText(/Bs|\$/);
    await expect(barra).toBeInViewport();
    const abrir = barra.getByRole('button', { name: 'VER PEDIDO' });
    await abrir.click();
    const dlg = page.getByRole('dialog', { name: 'Mi pedido' });
    await expect(dlg).toBeVisible();
    // El foco inicial se pone en el mismo efecto que registra Escape: esperarlo evita una carrera.
    await expect(dlg.locator(':focus')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await expect(abrir).toBeFocused();
    // El pie queda por encima de la barra al llegar al final de la página.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const pie = await page.locator('footer').last().boundingBox();
    const caja = await barra.boundingBox();
    expect(pie).not.toBeNull();
    expect(caja).not.toBeNull();
    expect((pie?.y ?? 0) + (pie?.height ?? 0)).toBeLessThanOrEqual((caja?.y ?? 0) + 1);
  });

  test('un producto agotado (según la API) no muestra botones', async ({ page }) => {
    await simularApi(page);
    await page.route('**/api/disponibilidad*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ disponibilidad: { 'ejemplo-tv-55': 'agotado' } }) }));
    await decidirConsentimiento(page, false, false);
    await page.goto('/producto/televisor-ejemplo-55');
    await expect(page.getByText('TEMPORALMENTE AGOTADO')).toBeVisible();
    await expect(page.getByRole('link', { name: 'COMPRAR', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /COMPRAR|AGREGAR/ })).toHaveCount(0);
  });

  test('Mi pedido: agregar, cambiar cantidad y enviar por WhatsApp', async ({ page }) => {
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    await page.goto('/productos/lavadoras');
    const lavadora = page.locator('[data-producto-id="ejemplo-lavadora-9"]');
    await hidratar(lavadora);
    await islasListas(page);
    await lavadora.getByRole('button', { name: 'AGREGAR' }).click();
    await page.getByRole('button', { name: /Mi pedido, 1 producto/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Mi pedido' });
    await dlg.getByRole('button', { name: /Agregar una unidad/ }).click();
    const wa = dlg.getByRole('link', { name: /ENVIAR PEDIDO POR WHATSAPP/ });
    const texto = new URL((await wa.getAttribute('href')) ?? '').searchParams.get('text');
    expect(texto).toContain('2 x Lavadora de ejemplo 9 kg (cód. ejemplo-lavadora-9)');
  });

  test('Mi pedido muestra el «Total referencial» con su leyenda y el mensaje de WhatsApp lleva los mismos precios y el mismo total', async ({ page }) => {
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    // Un producto con stock y precio 0 (el ejemplo no trae ninguno): se simula en el archivo de precios.
    await page.route('**/precios-productos.json', async (r) => {
      const precios = (await (await r.fetch()).json()) as Record<string, Record<string, number>>;
      precios['ejemplo-tv-43'] = { BO: 0, AR: 0 };
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(precios) });
    });
    await page.goto('/productos/televisores');
    const tv55 = page.locator('[data-producto-id="ejemplo-tv-55"]');
    const tv43 = page.locator('[data-producto-id="ejemplo-tv-43"]');
    await hidratar(tv55);
    await hidratar(tv43);
    await tv55.getByRole('button', { name: 'AGREGAR' }).click();
    await tv43.getByRole('button', { name: 'AGREGAR' }).click();
    await page.getByRole('button', { name: /Mi pedido, 2 productos/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Mi pedido' });
    await expect(dlg.getByText('Total referencial')).toBeVisible();
    await expect(dlg.getByText('Bs 4.500', { exact: true })).toBeVisible();
    await expect(dlg.getByText('+ 1 con precio a consultar')).toBeVisible();
    await expect(dlg.getByText('El precio final y el envío se confirman por WhatsApp')).toBeVisible();
    const href = (await dlg.getByRole('link', { name: /ENVIAR PEDIDO POR WHATSAPP/ }).getAttribute('href')) ?? '';
    const mensaje = decodeURIComponent(href);
    expect(mensaje).toContain('(cód. ejemplo-tv-55): Bs 4.500 c/u, subtotal Bs 4.500');
    expect(mensaje).toContain('(cód. ejemplo-tv-43): precio a consultar');
    expect(mensaje).toContain('Total referencial: Bs 4.500');
  });

  test('el botón flotante de WhatsApp lleva el pedido cuando hay productos y la consulta general cuando no', async ({ page }) => {
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    await page.goto('/producto/televisor-ejemplo-55');
    await islasListas(page);
    const flotante = page.locator('a.whatsapp-flotante');
    expect(new URL((await flotante.getAttribute('href')) ?? '').searchParams.get('text')).toBe('Hola, tengo una consulta.');
    await page.getByRole('button', { name: 'AGREGAR' }).click();
    await expect.poll(async () => new URL((await flotante.getAttribute('href')) ?? '').searchParams.get('text')).toContain('1 x Televisor de ejemplo 55" (cód. ejemplo-tv-55): Bs ');
    await expect.poll(async () => new URL((await flotante.getAttribute('href')) ?? '').searchParams.get('text')).toMatch(/c\/u, subtotal Bs .*\nTotal referencial: Bs .*\nEl precio final y el envío se confirman por WhatsApp$/);
  });

  test('«Buscar en el catálogo» encuentra un producto de otra página', async ({ page }) => {
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/productos/televisores');
    await islasListas(page);
    // El alcance de «Refinar la búsqueda» es toda la lista de la página (aquí, los televisores): una lavadora no aparece.
    await page.getByRole('button', { name: 'Refinar la búsqueda' }).click();
    await page.getByRole('dialog', { name: 'Refinar la búsqueda' }).getByRole('searchbox', { name: 'Nombre' }).fill('televisor nordika');
    await expect(page.getByRole('status').filter({ hasText: '1 producto' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: /Ver 1 producto/ }).click();
    await expect(page.locator('.grilla-productos:not([data-lista-servidor]) [data-producto-id]')).toHaveCount(1);
    await expect(page.locator('.grilla-productos:not([data-lista-servidor]) [data-producto-id="ejemplo-tv-43"]')).toBeVisible();
  });

  test('un producto que se agota después de construir el sitio se oculta en vivo (según /api/disponibilidad), también en los resultados', async ({ page }) => {
    await simularApi(page);
    await page.route('**/api/disponibilidad*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ disponibilidad: { 'ejemplo-tv-55': 'agotado', 'ejemplo-tv-43': 'disponible' } }) }));
    await decidirConsentimiento(page, false, false);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/productos/televisores');
    await islasListas(page);
    await expect(page.locator('[data-lista-servidor] [data-producto-id="ejemplo-tv-55"]')).toBeHidden();
    await expect(page.locator('[data-lista-servidor] [data-producto-id="ejemplo-tv-43"]')).toBeVisible();
    await page.getByRole('button', { name: 'Refinar la búsqueda' }).click();
    await page.getByRole('dialog').getByRole('searchbox', { name: 'Nombre' }).fill('televisor');
    await expect(page.getByRole('status').filter({ hasText: '1 producto' })).toBeVisible();
  });

  test('«Refinar la búsqueda» en todo el catálogo encuentra un producto de otra categoría', async ({ page }) => {
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/productos');
    await islasListas(page);
    await page.getByRole('button', { name: 'Refinar la búsqueda' }).click();
    await page.getByRole('dialog').getByRole('searchbox', { name: 'Nombre' }).fill('lavadora nordika');
    await expect(page.getByRole('status').filter({ hasText: '1 producto' })).toBeVisible();
  });

  test('en el celular (375 px) las migas no se superponen y el título queda a 16 px o más del borde', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    await page.goto('/producto/televisor-ejemplo-55');
    await islasListas(page);
    const cajas = await page.locator('.migas li').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
    expect(cajas.length).toBeGreaterThan(1);
    for (let i = 0; i < cajas.length; i += 1) {
      for (let j = i + 1; j < cajas.length; j += 1) {
        const a = cajas[i]!;
        const b = cajas[j]!;
        const solapa = a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
        expect(solapa, `migas ${i} y ${j}`).toBe(false);
      }
    }
    expect((await page.locator('.pagina h1').first().boundingBox())?.x ?? 0).toBeGreaterThanOrEqual(16);
  });

  test('buscador y filtros por marca y precio', async ({ page }) => {
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    await page.goto('/productos');
    await islasListas(page);
    await page.getByRole('button', { name: 'Buscar productos' }).click();
    await page.getByRole('dialog').getByRole('searchbox').fill('lavadora nordika');
    await expect(page.getByRole('dialog').getByRole('link')).toHaveCount(1);
    await page.keyboard.press('Escape');
    // Cada marca de la portada lleva a su propia página estática (el 65" de Aurora está sin stock: quedan 2).
    await page.goto('/');
    await islasListas(page);
    await page.getByRole('navigation', { name: 'Marcas' }).getByRole('link', { name: 'Aurora' }).click();
    await expect(page).toHaveURL(/\/marca\/aurora$/);
    await islasListas(page);
    await expect(page.locator('[data-producto-id]')).toHaveCount(2);
    await page.goto('/productos');
    await islasListas(page);
    // Marca y precio en la columna de la computadora (1280 px), con el mismo componente que la hoja del celular.
    await page.setViewportSize({ width: 1280, height: 900 });
    const columna = page.getByRole('complementary', { name: 'Filtros' });
    await expect(columna).toBeVisible();
    await columna.getByRole('button', { name: 'Aurora' }).click();
    await expect(page.getByRole('status').filter({ hasText: '2 productos' })).toBeVisible();
    await columna.getByRole('button', { name: 'Aurora' }).click();
    await expect(page.getByRole('status').filter({ hasText: /productos/ })).toHaveCount(0);
    // Precio: el máximo llevado al mínimo con Inicio deja solo lo más barato y se ocultan las tarjetas de la página.
    await columna.getByRole('slider', { name: 'Precio máximo' }).focus();
    await page.keyboard.press('Home');
    await expect(page.getByRole('status').filter({ hasText: /^\d+ productos?$/ })).toBeVisible();
    await expect(page.locator('[data-producto-id="ejemplo-heladera-450"]')).toBeHidden();
  });

  test('Compartir: sin navigator.share copia el enlace y avisa; con navigator.share lo usa', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    await page.addInitScript(() => Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }));
    await page.goto('/producto/televisor-ejemplo-55');
    await islasListas(page);
    await page.getByRole('button', { name: 'COMPARTIR' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Enlace copiado' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/producto\/televisor-ejemplo-55$/);
  });

  test('Compartir con navigator.share envía el título y el enlace de la ficha', async ({ page }) => {
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    await page.addInitScript(() => {
      (window as unknown as { compartido?: unknown }).compartido = null;
      Object.defineProperty(navigator, 'share', { value: (d: unknown) => { (window as unknown as { compartido?: unknown }).compartido = d; return Promise.resolve(); }, configurable: true });
    });
    await page.goto('/producto/televisor-ejemplo-55');
    await islasListas(page);
    await page.getByRole('button', { name: 'COMPARTIR' }).click();
    const d = (await page.evaluate(() => (window as unknown as { compartido: { title: string; url: string } }).compartido));
    expect(d.url).toMatch(/\/producto\/televisor-ejemplo-55$/);
    expect(d.title).not.toBe('');
  });

  test('con pocos productos no hay paginación y las miniaturas se ven completas', async ({ page }) => {
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    await page.goto('/productos');
    await expect(page.getByRole('navigation', { name: 'Páginas del catálogo' })).toHaveCount(0);
    await expect(page.locator('link[rel="prev"], link[rel="next"]')).toHaveCount(0);
    expect((await page.request.get('/productos/pagina/2')).status()).toBe(404);
    const imagen = page.locator('.tarjeta-imagen img').first();
    await expect(imagen).toBeAttached();
    expect(await imagen.evaluate((e) => getComputedStyle(e).objectFit)).toBe('contain');
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

test.describe('menú plegable en celular', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('hamburguesa a la izquierda: se alcanza con Tab, abre con Enter, panel en columna, aria-current y cabecera compacta', async ({ page }) => {
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    await page.goto('/productos');
    await islasListas(page);
    await expect(page.getByRole('navigation', { name: 'Principal', exact: true })).toBeHidden();
    const cabecera = page.locator('header.cabecera');
    expect((await cabecera.boundingBox())?.height ?? 999).toBeLessThanOrEqual(140);
    const boton = page.locator('.menu-movil > summary');
    await expect(boton).toHaveAccessibleName('Menú');
    for (let i = 0; i < 10 && !(await boton.evaluate((el) => el === document.activeElement)); i += 1) await page.keyboard.press('Tab');
    await expect(boton).toBeFocused();
    await page.keyboard.press('Enter');
    const nav = page.getByRole('navigation', { name: 'Principal (móvil)' });
    await expect(nav).toBeVisible();
    const enlaces = nav.getByRole('link');
    const n = await enlaces.count();
    expect(n).toBeGreaterThanOrEqual(4);
    let anterior = -1;
    for (let i = 0; i < n; i += 1) {
      const caja = await enlaces.nth(i).boundingBox();
      expect(caja?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(caja?.x ?? 999).toBeLessThan(60);
      expect(caja?.y ?? 0).toBeGreaterThan(anterior);
      anterior = caja?.y ?? 0;
    }
    await expect(nav.getByRole('link', { name: 'Productos' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Contacto' })).not.toHaveAttribute('aria-current', 'page');
    expect((await cabecera.boundingBox())?.height ?? 999).toBeLessThanOrEqual(140);
    await page.keyboard.press('Enter');
    await expect(nav).toBeHidden();
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

  test('contacto: «ENVIAR POR WHATSAPP» abre wa.me con el nombre y el mensaje, sin enviar nada al servidor ni cargar reCAPTCHA', async ({ page }) => {
    const { errores, peticiones } = vigilar(page);
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    const posts: string[] = [];
    page.on('request', (r) => r.method() === 'POST' && posts.push(r.url()));
    await page.goto('/contacto');
    await islasListas(page);
    const enviar = page.getByRole('link', { name: /ENVIAR POR WHATSAPP/ });
    const nombre = page.getByLabel('Nombre', { exact: true });
    const mensaje = page.getByLabel('Mensaje');
    await expect(nombre).toHaveAttribute('aria-required', 'true');
    await expect(mensaje).toHaveAttribute('aria-required', 'true');
    await expect(enviar.locator('.solo-lectores')).toHaveText('(se abre en una pestaña nueva)');
    // Sin nombre ni mensaje el enlace lleva el mensaje general; al pulsar no se abre nada, se avisa y el foco va al primer campo inválido.
    expect(new URL((await enviar.getAttribute('href')) ?? '').searchParams.get('text')).toBe('Hola, tengo una consulta.');
    await enviar.click();
    await expect(page.getByRole('alert')).toContainText('Revisa los campos marcados');
    await expect(nombre).toBeFocused();
    await expect(nombre).toHaveAttribute('aria-describedby', 'error-nombre');
    await expect(page.locator('#error-nombre')).toHaveText('Escribe tu nombre');
    await nombre.fill('Ana Pérez');
    await enviar.click();
    await expect(mensaje).toBeFocused();
    await expect(mensaje).toHaveAttribute('aria-describedby', 'error-mensaje');
    await mensaje.fill('Quisiera saber el precio.');
    const url = new URL((await enviar.getAttribute('href')) ?? '');
    expect(url.origin + url.pathname).toBe('https://wa.me/59100000001');
    expect(url.searchParams.get('text')).toBe('Hola, soy Ana Pérez.\nQuisiera saber el precio.');
    await expect(enviar).toHaveAttribute('target', '_blank');
    // Con los datos completos se abre wa.me en una pestaña nueva (sin red real), con el texto escrito.
    await page.context().route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: 'ok' }));
    const [nueva] = await Promise.all([page.waitForEvent('popup'), enviar.click()]);
    await nueva.waitForURL(/^https:\/\/wa\.me\/59100000001/);
    expect(new URL(nueva.url()).searchParams.get('text')).toBe('Hola, soy Ana Pérez.\nQuisiera saber el precio.');
    // El Enter dentro del formulario también valida y abre.
    const [otra] = await Promise.all([page.waitForEvent('popup'), nombre.press('Enter')]);
    await otra.waitForURL(/wa\.me/);
    expect(posts).toEqual([]);
    expect(peticiones.some((u) => /recaptcha|appcheck|api\/contacto/i.test(u))).toBe(false);
    expect(errores).toEqual([]);
  });

  test('pedido: el carrito manda por WhatsApp cantidad, código, precio unitario, subtotal y total en la moneda elegida', async ({ page }) => {
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    await page.goto('/producto/televisor-ejemplo-55');
    await islasListas(page);
    await page.getByRole('button', { name: /Agregar al pedido/ }).click();
    await page.getByRole('button', { name: /Agregar al pedido/ }).click();
    await page.getByRole('button', { name: /^Mi pedido/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Mi pedido' });
    await expect(dlg.locator('.total-linea strong').first()).toHaveText(/^Bs /);
    const total = (await dlg.locator('.total-linea strong').first().innerText()).trim();
    const wa = dlg.getByRole('link', { name: /ENVIAR PEDIDO POR WHATSAPP/ });
    await expect(wa).toHaveAttribute('href', /text=.*Total/);
    const texto = new URL((await wa.getAttribute('href')) ?? '').searchParams.get('text') ?? '';
    expect(texto).toContain('2 x Televisor de ejemplo 55" (cód. ejemplo-tv-55): Bs ');
    expect(texto).toMatch(/ c\/u, subtotal Bs /);
    expect(texto).toContain(`Total referencial: ${total}`);
    expect(texto.endsWith('El precio final y el envío se confirman por WhatsApp')).toBe(true);
  });

  test('pedido: en el mercado de Argentina el mensaje va en pesos', async ({ page }) => {
    await simularApi(page);
    await page.addInitScript(() => {
      localStorage.setItem('cb.consentimiento', JSON.stringify({ v: 1, analitica: false, marketing: false }));
      localStorage.setItem('cb.mercado', 'AR');
    });
    await page.goto('/producto/televisor-ejemplo-55');
    await islasListas(page);
    await page.getByRole('button', { name: /Agregar al pedido/ }).click();
    await page.getByRole('button', { name: /^Mi pedido/ }).click();
    const wa = page.getByRole('dialog', { name: 'Mi pedido' }).getByRole('link', { name: /ENVIAR PEDIDO POR WHATSAPP/ });
    await expect(wa).toHaveAttribute('href', /Total/);
    const texto = new URL((await wa.getAttribute('href')) ?? '').searchParams.get('text') ?? '';
    expect(texto).toMatch(/c\/u, subtotal \$ /);
    expect(texto).toMatch(/Total referencial: \$ /);
    expect(texto).not.toMatch(/Bs /);
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

  for (const plantilla of PLANTILLAS) {
    for (const tema of ['claro', 'oscuro'] as const) {
      test(`celular con el menú abierto: ${plantilla} / ${tema}`, async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 740 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await simularApi(page);
        await decidirConsentimiento(page, false, false);
        await page.goto('/');
        await page.waitForLoadState('networkidle');
        await page.evaluate(([p, t]) => {
          document.documentElement.dataset['plantilla'] = p;
          document.documentElement.dataset['tema'] = t;
        }, [plantilla, tema] as const);
        await page.locator('.menu-movil > summary').click();
        await expect(page.getByRole('navigation', { name: 'Principal (móvil)' })).toBeVisible();
        await auditar(page, `movil/${plantilla}/${tema}`);
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
    await page.getByRole('button', { name: /Mi pedido/ }).click();
    await auditar(page, 'carrito-vacio');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Buscar productos' }).click();
    await auditar(page, 'buscador');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Convertidor de precios' }).click();
    await auditar(page, 'convertidor');
  });
});

test.describe('celular (375×812): grilla de 2 columnas, cabecera que se oculta y marcas en fila', () => {
  test.use({ viewport: { width: 375, height: 812 } });
  const preparar = async (page: Page, plantilla: string, tema: string, ruta: string): Promise<void> => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    await page.goto(ruta);
    await islasListas(page);
    await page.evaluate(([p, t]) => {
      document.documentElement.dataset['plantilla'] = p;
      document.documentElement.dataset['tema'] = t;
    }, [plantilla, tema] as const);
    // Cambiar plantilla o tema mueve la cabecera y la grilla (tipografías, medidas): se espera a que el diseño se asiente antes de
    // desplazar; si no, un cambio de altura posterior movía el desplazamiento y la isla veía una subida y mostraba la cabecera.
    await page.evaluate(async () => {
      await document.fonts.ready;
      const cuadro = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));
      let alto = -1;
      for (let i = 0; i < 20; i += 1) {
        await cuadro();
        const h = document.documentElement.scrollHeight + document.querySelector('.grilla-productos, main')!.getBoundingClientRect().top;
        if (h === alto) break;
        alto = h;
      }
    });
  };

  for (const plantilla of PLANTILLAS) {
   for (const tema of ['claro', 'oscuro'] as const) {
    test(`${plantilla} / ${tema}: /productos muestra al menos 5 tarjetas con su descripción tras ocultar la cabecera, sin desborde`, async ({ page }) => {
      await preparar(page, plantilla, tema, '/productos');
      // Dos pasos, como un dedo real: el primero arma la referencia de la isla y el segundo, ya con dy > 4, la oculta.
      await page.evaluate(() => new Promise<void>((r) => {
        const meta = document.querySelector('.grilla-productos')!.getBoundingClientRect().top + window.scrollY - 4;
        window.scrollTo(0, meta / 2);
        requestAnimationFrame(() => requestAnimationFrame(() => { window.scrollTo(0, meta); r(); }));
      }));
      await expect(page.locator('.cabecera')).toHaveClass(/cabecera-oculta/);
      const columnas = await page.locator('.grilla-productos').evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length);
      expect(columnas).toBe(2);
      const visibles = await page.locator('.tarjeta').evaluateAll((els, h) => els.filter((e) => {
        const d = e.querySelector('.tarjeta-descripcion')!.getBoundingClientRect();
        return d.top >= 0 && d.bottom <= h;
      }).length, 812);
      expect(visibles).toBeGreaterThanOrEqual(5);
      // Las dos acciones siguen en la tarjeta (D10) y AGREGAR conserva su nombre accesible.
      await expect(page.locator('.tarjeta').first().getByRole('button', { name: 'AGREGAR' })).toBeVisible();
      await expect(page.locator('.tarjeta').first().getByRole('link', { name: 'COMPRAR', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
      // La barra fija «Tu pedido» sigue abajo con la cabecera oculta.
      const barra = await page.getByRole('region', { name: 'Tu pedido' }).boundingBox();
      expect(barra).not.toBeNull();
      expect(barra!.y).toBeGreaterThan(700);
      expect(barra!.y + barra!.height).toBeLessThanOrEqual(812.5);
      // Al subir, la cabecera vuelve.
      await page.evaluate(() => window.scrollBy(0, -200));
      await expect(page.locator('.cabecera')).not.toHaveClass(/cabecera-oculta/);
    });
   }
  }

  test('con el foco en un botón de la cabecera, bajar con el dedo igual la oculta', async ({ page }) => {
    await preparar(page, 'cielo', 'claro', '/productos');
    await page.getByRole('button', { name: /Buscar productos/ }).first().focus();
    await page.mouse.move(4, 400);
    await page.mouse.down();
    await page.mouse.up();
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(page.locator('.cabecera')).toHaveClass(/cabecera-oculta/);
  });

  test('en una pantalla ancha la cabecera nunca se oculta', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await preparar(page, 'cielo', 'claro', '/productos');
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.evaluate(() => window.scrollTo(0, 800));
    await page.waitForTimeout(150);
    await expect(page.locator('.cabecera')).not.toHaveClass(/cabecera-oculta/);
  });

  test('la portada: marcas en fila que se desplazan sin desbordar y chips de categoría que filtran la grilla ahí mismo', async ({ page }) => {
    await preparar(page, 'cielo', 'claro', '/');
    const fila = page.getByRole('navigation', { name: 'Marcas' }).locator('ul');
    expect(await fila.evaluate((e) => ({ flex: getComputedStyle(e).display, x: getComputedStyle(e).overflowX }))).toEqual({ flex: 'flex', x: 'auto' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
    const chips = page.getByRole('navigation', { name: 'Categorías de productos' });
    await chips.scrollIntoViewIfNeeded();
    await expect(chips.getByRole('link', { name: 'Todos' })).toHaveAttribute('aria-current', 'true');
    const visibles = page.locator('#portada-grilla .tarjeta:visible');
    const todos = await visibles.count();
    expect(todos).toBeGreaterThan(0);
    const url = page.url();
    // Los chips caben en una sola fila que se desplaza.
    expect(await chips.locator('ul').evaluate((e) => ({ envuelve: getComputedStyle(e).flexWrap, x: getComputedStyle(e).overflowX }))).toEqual({ envuelve: 'nowrap', x: 'auto' });
    await chips.getByRole('link', { name: 'Televisores' }).focus();
    await page.keyboard.press('Enter');
    await expect(chips.getByRole('link', { name: 'Televisores' })).toHaveAttribute('aria-current', 'true');
    expect(page.url()).toBe(url);
    // La grilla se actualiza justo después de marcar el chip: se espera con aserciones que reintentan, no con una lectura única.
    await expect(page.locator('#portada-grilla .tarjeta:visible .tarjeta-etiqueta:text-is("Televisores")')).not.toHaveCount(0);
    await expect(page.locator('#portada-grilla .tarjeta:visible .tarjeta-etiqueta:not(:text-is("Televisores"))')).toHaveCount(0);
    await expect(page.locator('#portada-ver-todos')).toHaveAttribute('href', '/productos/televisores');
    await expect(chips.locator('xpath=following-sibling::p[@role="status"]')).toHaveText(/^Televisores: \d+ productos?$/);
    await chips.getByRole('link', { name: 'Todos' }).click();
    await expect(visibles).toHaveCount(todos);
    await expect(page.locator('#portada-ver-todos')).toHaveAttribute('href', '/productos');
  });

  test('catálogo en 375 px: las categorías van en una sola fila que se desplaza y conservan aria-current', async ({ page }) => {
    await preparar(page, 'cielo', 'claro', '/productos/televisores');
    const nav = page.getByRole('navigation', { name: 'Categorías' });
    expect(await nav.evaluate((e) => ({ dir: getComputedStyle(e).flexDirection, envuelve: getComputedStyle(e).flexWrap, x: getComputedStyle(e).overflowX }))).toEqual({ dir: 'row', envuelve: 'nowrap', x: 'auto' });
    const filas = await nav.getByRole('link').evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size);
    expect(filas).toBe(1);
    await expect(nav.getByRole('link', { name: 'Televisores' })).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
  });

  for (const plantilla of PLANTILLAS) {
    for (const tema of ['claro', 'oscuro'] as const) {
      test(`${plantilla} / ${tema}: tras elegir una categoría la primera foto se ve sin bajar y «Refinar la búsqueda» abre y cierra con teclado`, async ({ page }) => {
        await preparar(page, plantilla, tema, '/productos');
        await page.getByRole('navigation', { name: 'Categorías' }).getByRole('link', { name: 'Televisores' }).click();
        await expect(page).toHaveURL(/\/productos\/televisores$/);
        await islasListas(page);
        const caja = await page.locator('.tarjeta-imagen').first().boundingBox();
        expect(caja).not.toBeNull();
        expect(caja!.y).toBeGreaterThanOrEqual(0);
        expect(caja!.y + Math.min(caja!.height, 120)).toBeLessThanOrEqual(812);
        const boton = page.getByRole('button', { name: 'Refinar la búsqueda' });
        await boton.focus();
        await page.keyboard.press('Enter');
        const panel = page.getByRole('dialog', { name: 'Refinar la búsqueda' });
        await expect(panel).toBeVisible();
        await expect(panel.getByRole('slider', { name: 'Precio mínimo' })).toHaveAttribute('aria-valuetext', /Desde Bs .* BOB/);
        await expect(panel.getByRole('slider', { name: 'Precio máximo' })).toHaveAttribute('aria-valuetext', /Hasta Bs .* BOB/);
        // Foco atrapado: tras muchas pulsaciones de Tab el foco sigue dentro de la hoja.
        for (let i = 0; i < 12; i += 1) await page.keyboard.press('Tab');
        expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true);
        await auditar(page, `refinar/${plantilla}/${tema}`);
        await page.keyboard.press('Escape');
        await expect(panel).toHaveCount(0);
        await expect(boton).toBeFocused();
      });
    }
  }

  test('ficha: volver al catálogo, categoría y relacionados con precio', async ({ page }) => {
    await preparar(page, 'cielo', 'claro', '/producto/televisor-ejemplo-55');
    await expect(page.getByRole('link', { name: 'Volver al catálogo' })).toHaveAttribute('href', '/productos');
    await expect(page.locator('.ficha-meta').getByRole('link', { name: 'Televisores' })).toBeVisible();
    const rel = page.getByRole('region', { name: 'Productos relacionados' });
    await expect(rel.locator('.relacionado')).toHaveCount(2);
    await rel.scrollIntoViewIfNeeded();
    await expect(rel.locator('.precio-valor').first()).toBeVisible();
    await expect(rel.getByRole('link', { name: 'Televisor de ejemplo 55"' })).toHaveCount(0);
  });

  for (const plantilla of PLANTILLAS) {
    for (const tema of ['claro', 'oscuro'] as const) {
      test(`axe en el celular: ${plantilla} / ${tema}`, async ({ page }) => {
        for (const ruta of ['/productos', '/', '/producto/televisor-ejemplo-55']) {
          await preparar(page, plantilla, tema, ruta);
          await page.waitForLoadState('networkidle');
          await auditar(page, `movil/${plantilla}/${tema}${ruta}`);
        }
      });
    }
  }
});

test.describe('secciones opcionales del contenido', () => {
  test('portada: misión, visión y maqueta de chat aparecen con contenido', async ({ page }) => {
    await simularApi(page);
    await page.goto('/');
    const sec = page.locator('#institucional');
    await expect(sec).toBeVisible();
    await expect(sec.getByRole('heading', { name: 'Nuestra misión' })).toBeVisible();
    await expect(sec.getByRole('heading', { name: 'Nuestra visión' })).toBeVisible();
    await expect(sec.getByText('Ejemplo de conversación')).toBeVisible();
    await expect(sec.locator('.chat-mensaje')).toHaveCount(2);
  });

  test('ficha: las características salen en viñetas y, vacías, la sección no existe', async ({ page }) => {
    await simularApi(page);
    await page.goto('/producto/televisor-ejemplo-55');
    await expect(page.getByRole('heading', { name: 'Características destacadas' })).toBeVisible();
    await expect(page.locator('.ficha-caracteristicas li')).toHaveCount(3);
    await page.goto('/producto/televisor-ejemplo-65');
    await expect(page.getByRole('heading', { name: 'Características destacadas' })).toHaveCount(0);
    await expect(page.locator('.ficha-caracteristicas')).toHaveCount(0);
  });
});
