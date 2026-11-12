import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const ESQUEMAS = ['light', 'dark'] as const;

/** Cuentas de los dobles en memoria (inventadas para pruebas). */
const CUENTAS = {
  caj: ['caj@ejemplo.test', 'clave-caj-1'],
  sup: ['sup@ejemplo.test', 'clave-sup-1'],
  adm: ['adm@ejemplo.test', 'clave-adm-1'],
} as const;

/** Registra errores de consola/página (incluidas violaciones de CSP) y las peticiones. */
function vigilar(page: Page): { errores: string[]; peticiones: string[] } {
  const errores: string[] = [];
  const peticiones: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || /Content.Security.Policy|Refused to/i.test(m.text())) errores.push(`consola: ${m.text()}`);
  });
  page.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`));
  page.on('request', (r) => peticiones.push(r.url()));
  return { errores, peticiones };
}

async function sinViolaciones(page: Page, donde: string): Promise<void> {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const resumen = r.violations.map((v) => `${v.id} (${v.impact ?? '?'}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
  expect(resumen, `axe en ${donde}`).toEqual([]);
}

async function entrar(page: Page, rol: keyof typeof CUENTAS): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Correo').fill(CUENTAS[rol][0]);
  await page.getByLabel('Contraseña').fill(CUENTAS[rol][1]);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('navigation', { name: 'Menú principal' })).toBeVisible();
}

const hostPropio = (u: string): boolean => /^(http:\/\/127\.0\.0\.1|data:|blob:)/.test(u);

for (const esquema of ESQUEMAS) {
  test.describe(`tema ${esquema === 'light' ? 'claro' : 'oscuro'}`, () => {
    test.use({ colorScheme: esquema });

    test('inicio de sesión: accesible, sin errores de CSP ni peticiones externas, y un correo sin verificar no entra', async ({ page }) => {
      const v = vigilar(page);
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Panel de gestión' })).toBeVisible();
      await sinViolaciones(page, 'inicio de sesión');
      await page.getByLabel('Correo').fill('nuevo@ejemplo.test');
      await page.getByLabel('Contraseña').fill('clave-nuevo-1');
      await page.getByRole('button', { name: 'Entrar' }).click();
      await expect(page.getByText(/Verifica tu correo/)).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Menú principal' })).toHaveCount(0);
      await sinViolaciones(page, 'correo sin verificar');
      await page.getByLabel('Correo').fill('adm@ejemplo.test');
      await page.getByLabel('Contraseña').fill('mala');
      await page.getByRole('button', { name: 'Entrar' }).click();
      await expect(page.getByRole('alert')).toContainText('no son correctos');
      expect(v.errores).toEqual([]);
      expect(v.peticiones.filter((u) => !hostPropio(u))).toEqual([]);
    });

    test('flujo de venta completo: turno, terminal, descuento, cobro con cambio, recibo, cierre', async ({ page }) => {
      const v = vigilar(page);
      await entrar(page, 'caj');
      await expect(page.getByRole('link', { name: 'Inventario' })).toHaveCount(0);
      // Apertura de turno.
      await expect(page.getByRole('heading', { name: 'Abrir turno' })).toBeVisible();
      await sinViolaciones(page, 'apertura de turno');
      await page.getByLabel(/Efectivo inicial en Bolivianos/).fill('100');
      await page.getByRole('button', { name: 'Abrir turno' }).click();
      // Terminal.
      await expect(page.getByRole('heading', { name: 'Productos' })).toBeVisible();
      await expect(page.getByText(/Cotización: 1 USD = 6,96 BOB/)).toBeVisible();
      await page.getByLabel(/Buscar por nombre/).fill('hdmi');
      await page.getByRole('button', { name: 'Agregar Cable HDMI 2 m' }).click();
      await expect(page.locator('[data-prueba="total"]')).toHaveText('Bs 55,68');
      await sinViolaciones(page, 'terminal con carrito');
      // Un descuento sobre el tope pide aprobación.
      await page.getByLabel(/Descuento \(monto\)/).fill('10');
      await page.getByLabel(/Motivo del descuento/).fill('Cliente frecuente');
      await expect(page.getByText(/supera su tope/)).toBeVisible();
      await sinViolaciones(page, 'descuento por encima del tope');
      await page.getByLabel(/Descuento \(monto\)/).fill('2');
      await expect(page.locator('[data-prueba="total"]')).toHaveText('Bs 53,68');
      // Cobro con cambio.
      await page.getByRole('button', { name: 'Cobrar' }).click();
      await expect(page.getByRole('heading', { name: 'Cobro' })).toBeVisible();
      await page.getByLabel(/Monto a aplicar/).fill('53,68');
      await page.getByLabel(/Efectivo recibido/).fill('100');
      await expect(page.locator('[data-prueba="cambio"]')).toHaveText('Bs 46,32');
      await sinViolaciones(page, 'cobro');
      await page.getByRole('button', { name: 'Confirmar cobro' }).click();
      // Recibo.
      await expect(page.getByRole('heading', { name: 'Venta registrada' })).toBeVisible();
      await expect(page.getByRole('article', { name: 'Recibo A-000001' })).toBeVisible();
      await sinViolaciones(page, 'recibo');
      await expect(page.getByRole('button', { name: 'Imprimir' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Preparar WhatsApp' })).toBeVisible();
      await page.getByRole('link', { name: 'Mis recibos' }).click();
      await expect(page.getByRole('heading', { name: 'Mis recibos' })).toBeVisible();
      await expect(page.getByRole('rowheader', { name: 'A-000001' })).toBeVisible();
      await sinViolaciones(page, 'archivo de recibos');
      // Cierre con arqueo: el faltante queda negativo.
      await page.goto('/#/venta/cierre');
      await page.getByLabel(/Efectivo contado en BOB/).fill('100');
      await expect(page.locator('[data-prueba="diferencia-BOB"]')).toContainText('faltante');
      await sinViolaciones(page, 'cierre de turno');
      await page.getByRole('button', { name: 'Cerrar turno' }).click();
      await page.getByRole('button', { name: 'Sí, cerrar turno' }).click();
      await expect(page.getByRole('heading', { name: 'Turno cerrado' })).toBeVisible();
      await sinViolaciones(page, 'turno cerrado');
      expect(v.errores).toEqual([]);
      expect(v.peticiones.filter((u) => !hostPropio(u))).toEqual([]);
    });

    test('inventario básico: existencias por almacén, alerta de mínimo, ficha con precio del día y conteo ciego', async ({ page }) => {
      const v = vigilar(page);
      await entrar(page, 'sup');
      await page.getByRole('link', { name: 'Inventario' }).click();
      await expect(page.getByRole('table', { name: 'Productos y existencias por almacén' })).toBeVisible();
      await expect(page.getByText(/Alerta de mínimo/)).toBeVisible();
      await sinViolaciones(page, 'inventario');
      await page.getByRole('button', { name: 'Ficha de Televisor 55 pulgadas' }).click();
      await expect(page.locator('[data-prueba="precio-bo"]')).toContainText('Bs 3.132,00');
      await sinViolaciones(page, 'ficha de producto');
      await page.getByRole('link', { name: 'Conteo ciego' }).click();
      await page.getByRole('button', { name: 'Abrir conteo' }).click();
      await expect(page.getByText(/Conteo abierto en/)).toBeVisible();
      await sinViolaciones(page, 'conteo ciego');
      await page.getByRole('link', { name: 'Registro de acciones' }).click();
      await expect(page.getByRole('heading', { name: 'Registro de acciones' })).toBeVisible();
      await sinViolaciones(page, 'registro de acciones');
      await page.getByRole('link', { name: 'Mermas' }).click();
      await expect(page.getByRole('heading', { name: 'Mermas', level: 1 })).toBeVisible();
      await sinViolaciones(page, 'mermas');
      expect(v.errores).toEqual([]);
    });

    test('catálogo básico: tablero, ficha con subida de foto, apariencia con vista previa y configuración', async ({ page }) => {
      const v = vigilar(page);
      await entrar(page, 'adm');
      await page.getByRole('link', { name: 'Catálogo y sitio' }).click();
      await expect(page.getByRole('heading', { name: 'Sitio', exact: true })).toBeVisible();
      await expect(page.getByText(/de 200/).first()).toBeVisible();
      await sinViolaciones(page, 'tablero');
      await page.getByRole('link', { name: 'Fichas, fotos y video' }).click();
      await page.getByRole('button', { name: 'Editar ficha de Televisor 55 pulgadas' }).click();
      await page.getByLabel('Subir fotos').setInputFiles({ name: 'frente.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('imagen de prueba') });
      await expect(page.getByText('frente.jpg: Listo')).toBeVisible();
      await page.getByLabel('Descripción del producto').fill('Televisor de 55 pulgadas.');
      await sinViolaciones(page, 'editor de ficha');
      await page.getByRole('button', { name: 'Guardar ficha' }).click();
      await expect(page.getByText(/Ficha guardada/)).toBeVisible();
      await page.getByRole('link', { name: 'Apariencia' }).click();
      await expect(page.getByRole('radio')).toHaveCount(5);
      await sinViolaciones(page, 'apariencia');
      await page.getByRole('link', { name: 'Tablero' }).click();
      await page.getByRole('button', { name: 'Publicar el sitio' }).click();
      await page.getByRole('button', { name: 'Sí, publicar' }).click();
      await expect(page.getByText(/Publicado: versión 1/)).toBeVisible();
      await sinViolaciones(page, 'tablero publicado');
      await page.getByRole('link', { name: 'Usuarios' }).click();
      await expect(page.getByText(/Personas con acceso/)).toBeVisible();
      await sinViolaciones(page, 'usuarios');
      await page.getByRole('link', { name: 'Configuración' }).click();
      await expect(page.getByRole('heading', { name: 'Datos del negocio y del POS' })).toBeVisible();
      await sinViolaciones(page, 'configuración');
      expect(v.errores).toEqual([]);
    });

    test('confirmación de «Quitar acceso»: diálogo accesible, Esc devuelve el foco y no hay estilos en línea', async ({ page }) => {
      const v = vigilar(page);
      await entrar(page, 'adm');
      await page.getByRole('link', { name: 'Usuarios' }).click();
      const quitar = page.getByRole('button', { name: 'Quitar acceso' }).first();
      await expect(quitar).toBeVisible();
      await quitar.click();
      const dialogo = page.getByRole('dialog');
      await expect(dialogo).toBeVisible();
      await expect(dialogo.getByRole('button', { name: 'Cancelar' })).toBeFocused();
      await sinViolaciones(page, 'confirmación de quitar acceso');
      expect(await page.content()).not.toMatch(/\sstyle=/);
      await page.keyboard.press('Escape');
      await expect(dialogo).toHaveCount(0);
      await expect(quitar).toBeFocused();
      expect(v.errores).toEqual([]);
    });
  });
}

test('el botón de tema fuerza claro u oscuro y se conserva al recargar', async ({ page }) => {
  await entrar(page, 'caj');
  await page.getByRole('button', { name: 'Tema: automático' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-tema', 'oscuro');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-tema', 'oscuro');
});

test('la respuesta lleva la CSP sellada, sin estilos ni scripts en línea', async ({ page }) => {
  const r = await page.goto('/');
  const csp = r?.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("style-src 'self'");
  expect(csp).not.toContain('unsafe-inline');
  expect(csp).not.toContain('unsafe-eval');
  expect(r?.headers()['x-content-type-options']).toBe('nosniff');
  const html = await page.content();
  expect(html).not.toMatch(/<style[\s>]/);
  expect(html).not.toMatch(/\sstyle=/);
});
