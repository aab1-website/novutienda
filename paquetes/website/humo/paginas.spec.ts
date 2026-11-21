import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { decidirConsentimiento, simularApi } from './comun.js';

// Sitio de 41 productos: el catálogo tiene 2 páginas (24 + 17).
test.describe('catálogo de más de una página', () => {
  test.beforeEach(async ({ page }) => {
    await simularApi(page);
    await decidirConsentimiento(page, false, false);
  });

  test('existe la página 2 y no la 3', async ({ page }) => {
    expect((await page.request.get('/productos/pagina/2')).status()).toBe(200);
    expect((await page.request.get('/productos/pagina/3')).status()).toBe(404);
  });

  test('la página 1 trae 24 productos y la 2, 17, con paginación', async ({ page }) => {
    await page.goto('/productos');
    await expect(page.locator('[data-producto-id]')).toHaveCount(24);
    await expect(page.getByRole('navigation', { name: 'Páginas del catálogo' }).getByRole('link', { name: 'Página 1' })).toHaveAttribute('aria-current', 'page');
    await page.goto('/productos/pagina/2');
    await expect(page.locator('[data-producto-id]')).toHaveCount(17);
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

  test('el filtro de precio avisa que solo filtra la página visible', async ({ page }) => {
    await page.goto('/productos/pagina/2');
    await expect(page.getByRole('status').filter({ hasText: 'Mostrando 17 de 17 productos de esta página (página 2 de 2).' })).toBeVisible();
    await expect(page.getByText('El filtro de precio actúa solo sobre los productos de la página que ves.')).toBeVisible();
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
