import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { decidirConsentimiento, simularApi } from './comun.js';

// Sitio de 41 productos (2 sin stock, que no se listan): el catálogo tiene 2 páginas (24 + 15).
test.describe('catálogo de más de una página', () => {
  test.beforeEach(async ({ page }) => {
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
  });

  test('existe la página 2 y no la 3', async ({ page }) => {
    expect((await page.request.get('/productos/pagina/2')).status()).toBe(200);
    expect((await page.request.get('/productos/pagina/3')).status()).toBe(404);
  });

  test('la página 1 trae 24 productos y la 2, 15, con paginación', async ({ page }) => {
    await page.goto('/productos');
    await expect(page.locator('[data-producto-id]')).toHaveCount(24);
    await expect(page.getByRole('navigation', { name: 'Páginas del catálogo' }).getByRole('link', { name: 'Página 1' })).toHaveAttribute('aria-current', 'page');
    await page.goto('/productos/pagina/2');
    await expect(page.locator('[data-producto-id]')).toHaveCount(15);
    await expect(page.getByRole('navigation', { name: 'Páginas del catálogo' }).getByRole('link', { name: 'Página 2' })).toHaveAttribute('aria-current', 'page');
  });

  test('canonical, rel=prev en la 2 y rel=next en la 1', async ({ page }) => {
    await page.goto('/productos/pagina/2');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/productos\/pagina\/2$/);
    await expect(page.locator('link[rel="prev"]')).toHaveAttribute('href', /\/productos$/);
    await expect(page.locator('link[rel="next"]')).toHaveCount(0);
    await page.goto('/productos');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/productos$/);
    await expect(page.locator('link[rel="next"]')).toHaveAttribute('href', /\/productos\/pagina\/2$/);
    await expect(page.locator('link[rel="prev"]')).toHaveCount(0);
  });

  test('los productos sin stock no se listan (39 de 41), pero su ficha existe', async ({ page }) => {
    await page.goto('/productos');
    await expect(page.locator('[data-producto-id="ejemplo-tv-65"]')).toHaveCount(0);
    expect((await page.request.get('/producto/televisor-ejemplo-65')).status()).toBe(200);
  });

  test('el sitemap incluye la página 2 y las páginas de marca', async ({ page }) => {
    const xml = await (await page.request.get('/sitemap.xml')).text();
    expect(xml).toContain('/productos/pagina/2<');
    expect(xml).not.toContain('/productos/pagina/3<');
    expect(xml).toMatch(/\/marca\/aurora</);
  });

  for (const ruta of ['/productos/pagina/2', '/marca/aurora']) {
    test(`axe sin infracciones en ${ruta}`, async ({ page }) => {
      await page.goto(ruta);
      await page.waitForLoadState('networkidle');
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      expect(r.violations.map((v) => `${ruta}: ${v.id} (${v.impact}) ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
    });
  }
});

// «Refinar la búsqueda» filtra todo el catálogo, no solo la página que se ve (celular de 375×812, las 5 plantillas).
test.describe('refinar la búsqueda en todo el catálogo (celular)', () => {
  test.use({ viewport: { width: 375, height: 812 } });
  for (const plantilla of ['cielo', 'bosque', 'ambar', 'grafito', 'ciruela']) {
    test(`${plantilla}: el deslizante filtra también la página 2 y los chips se quitan`, async ({ page }) => {
      await simularApi(page);
      await decidirConsentimiento(page, false, false);
      await page.goto('/productos/pagina/2');
      await page.evaluate((p) => { document.documentElement.dataset['plantilla'] = p; }, plantilla);
      await page.waitForFunction(() => document.querySelectorAll('astro-island[ssr][client="load"]').length === 0);
      await page.getByRole('button', { name: 'Refinar la búsqueda' }).click();
      const panel = page.getByRole('dialog', { name: 'Refinar la búsqueda' });
      const minimo = panel.getByRole('slider', { name: 'Precio mínimo' });
      await expect(minimo).toBeEnabled();
      // Mínimo al máximo posible con Fin: queda lo más caro de TODO el catálogo (que incluye la página 1).
      await minimo.focus();
      await page.keyboard.press('End');
      await expect(page.getByRole('status').filter({ hasText: /^\d+ productos?$/ })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('nav.paginacion')).toBeHidden();
      const ids = await page.locator('.grilla-productos:not([data-lista-servidor]) [data-producto-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-producto-id') ?? ''));
      expect(ids.length).toBeGreaterThan(0);
      // Los chips se pueden quitar y vuelven las tarjetas de la página.
      await expect(page.getByRole('list', { name: 'Filtros activos' })).toBeVisible();
      await page.getByRole('button', { name: 'Quitar el filtro de precio' }).click();
      await expect(page.getByRole('list', { name: 'Filtros activos' })).toHaveCount(0);
      await expect(page.locator('[data-lista-servidor] [data-producto-id]')).toHaveCount(15);
      await expect(page.locator('nav.paginacion')).toBeVisible();
    });

    test(`${plantilla}: una marca elegida muestra productos de las dos páginas`, async ({ page }) => {
      await simularApi(page);
      await decidirConsentimiento(page, false, false);
      await page.goto('/productos/pagina/2');
      await page.evaluate((p) => { document.documentElement.dataset['plantilla'] = p; }, plantilla);
      await page.waitForFunction(() => document.querySelectorAll('astro-island[ssr][client="load"]').length === 0);
      await page.getByRole('button', { name: 'Refinar la búsqueda' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Aurora' }).click();
      await page.keyboard.press('Escape');
      const ids = await page.locator('.grilla-productos:not([data-lista-servidor]) [data-producto-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-producto-id') ?? ''));
      expect(ids.some((i) => i.includes('-x'))).toBe(true);
      expect(ids.some((i) => !i.includes('-x'))).toBe(true);
      await page.getByRole('button', { name: 'Quitar la marca Aurora' }).click();
      await expect(page.locator('[data-lista-servidor] [data-producto-id]')).toHaveCount(15);
    });
  }
});

// Enlace «Cómo llegar»: este sitio se compila con `config.mapa` (el del ejemplo, en humo.spec, no lo trae).
test.describe('enlace al mapa de la tienda', () => {
  for (const ruta of ['/contacto', '/']) {
    test(`${ruta}: «Cómo llegar» abre Google Maps en una pestaña nueva, con rel noopener`, async ({ page }) => {
      await simularApi(page);
      await decidirConsentimiento(page, false, false);
      await page.goto(ruta);
      const enlace = page.getByRole('contentinfo').getByRole('link', { name: /Cómo llegar/ });
      await expect(enlace).toHaveAttribute('href', 'https://maps.app.goo.gl/AbC123');
      await expect(enlace).toHaveAttribute('target', '_blank');
      await expect(enlace).toHaveAttribute('rel', /noopener/);
    });
  }
  test('en contacto aparece junto a la dirección y el horario', async ({ page }) => {
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    await page.goto('/contacto');
    await expect(page.locator('.tarjeta-contacto').getByRole('link', { name: /Cómo llegar/ })).toHaveAttribute('href', 'https://maps.app.goo.gl/AbC123');
  });
});

// Guardia de regresión: a 390 px el catálogo no debe desbordar ni perder el margen lateral.
test.describe('catálogo en móvil de 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('/productos no desborda y conserva el margen lateral', async ({ page }) => {
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
    await page.goto('/productos');
    await page.waitForLoadState('networkidle');
    const m = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      cliente: document.documentElement.clientWidth,
      izquierdo: document.querySelector('.catalogo')?.getBoundingClientRect().left ?? -1,
    }));
    expect(m.scroll).toBeLessThanOrEqual(m.cliente);
    expect(m.izquierdo).toBeGreaterThanOrEqual(16);
  });
});
