import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { DOMINIOS_DE_MEDICION, decidirConsentimiento, simularApi, vigilar } from './comun.js';

const PAGINAS = ['/', '/404', '/productos', '/productos/televisores', '/producto/televisor-ejemplo-55', '/contacto', '/privacidad', '/seccion/como-comprar'];
const PLANTILLAS = ['cielo', 'bosque', 'ambar', 'grafito', 'ciruela'] as const;
/** Las islas `load` e `idle` ya están listas (las `visible` se hidratan al llegar a la pantalla). */
const islasListas = (page: Page): Promise<unknown> => page.waitForFunction(() => document.querySelectorAll('astro-island[ssr][client="load"], astro-island[ssr][client="idle"]').length === 0);
/** Lleva el elemento al centro de la pantalla (así todas sus islas quedan visibles) y espera a que se hidraten. */
async function hidratar(el: Locator): Promise<void> {
  await el.evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
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
    expect(url.searchParams.get('text')).toContain('1 x Televisor de ejemplo 55" (cód. ejemplo-tv-55)');
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

  test('Mi pedido muestra el «Total referencial» con su leyenda y el mensaje de WhatsApp no lleva el total', async ({ page }) => {
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
    expect(decodeURIComponent(href)).not.toMatch(/total|Bs|4\.500/i);
  });

  test('el botón flotante de WhatsApp lleva el pedido cuando hay productos y la consulta general cuando no', async ({ page }) => {
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    await page.goto('/producto/televisor-ejemplo-55');
    await islasListas(page);
    const flotante = page.locator('a.whatsapp-flotante');
    expect(new URL((await flotante.getAttribute('href')) ?? '').searchParams.get('text')).toBe('Hola, tengo una consulta.');
    await page.getByRole('button', { name: 'AGREGAR' }).click();
    await expect.poll(async () => new URL((await flotante.getAttribute('href')) ?? '').searchParams.get('text')).toContain('1 x Televisor de ejemplo 55" (cód. ejemplo-tv-55)');
  });

  test('«Buscar en el catálogo» encuentra un producto de otra página', async ({ page }) => {
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    await page.goto('/productos/televisores');
    await islasListas(page);
    await page.getByRole('searchbox', { name: 'Buscar en el catálogo' }).fill('lavadora nordika');
    await expect(page.getByRole('region', { name: 'Buscar en el catálogo' }).getByRole('link')).toHaveCount(1);
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
    const todas = page.locator('[data-producto-id]');
    const total = await todas.count();
    // Cada marca lleva a su propia página estática.
    await page.getByRole('navigation', { name: 'Marcas' }).getByRole('link', { name: 'Aurora' }).click();
    await expect(page).toHaveURL(/\/marca\/aurora$/);
    await islasListas(page);
    await expect(page.locator('[data-producto-id]')).toHaveCount(3);
    await expect(page.getByRole('navigation', { name: 'Marcas' }).getByRole('link', { name: 'Aurora' })).toHaveAttribute('aria-current', 'page');
    await page.goto('/productos');
    await islasListas(page);
    await page.getByLabel('Hasta').fill('3000');
    await expect(page.locator('[data-producto-id]:not([hidden])')).not.toHaveCount(total);
    await expect(page.locator('[data-producto-id="ejemplo-tv-65"]')).toBeHidden();
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
