// Panel REAL (compilación `emulador`) contra las funciones reales en el emulador de Firebase: Auth, Firestore, Storage y
// Functions con el proyecto ficticio `demo-pruebas`. Los usuarios se crean con el Admin SDK (correo verificado y claim `pl`).
import { expect, test, type Page } from '@playwright/test';

// Cuentas sembradas por `pruebas/panel/sembrar-e2e.test.ts` (correo y contraseña; claim `pl` con el rol).
const CLAVE = 'contraseña-de-prueba-123';
const adm = { correo: 'adm@e2e.test' };
const sup = { correo: 'sup@e2e.test' };
const caj = { correo: 'caj@e2e.test' };
const sinVerificar = { correo: 'sinverificar@e2e.test' };

/** Errores de consola/página (incluidas violaciones de CSP). Los 4xx de las funciones se verifican aparte. */
function vigilar(page: Page): { errores: string[] } {
  const errores: string[] = [];
  page.on('console', (m) => {
    if (/Content.Security.Policy|Refused to/i.test(m.text())) errores.push(`consola: ${m.text()}`);
  });
  page.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`));
  return { errores };
}

async function entrar(page: Page, u: { correo: string }): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Correo').fill(u.correo);
  await page.getByLabel('Contraseña').fill(CLAVE);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('navigation', { name: 'Menú principal' })).toBeVisible();
}

test('inicio de sesión real: contraseña incorrecta, correo sin verificar y acceso con rol', async ({ page }) => {
  const v = vigilar(page);
  await page.goto('/');
  await page.getByLabel('Correo').fill(sup.correo);
  await page.getByLabel('Contraseña').fill('mala-mala-mala');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toContainText('no son correctos');
  await page.getByLabel('Correo').fill(sinVerificar.correo);
  await page.getByLabel('Contraseña').fill(CLAVE);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText(/Verifica tu correo/)).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Menú principal' })).toHaveCount(0);
  await entrar(page, caj);
  await expect(page.getByRole('link', { name: 'Inventario' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Mis recibos' })).toBeVisible();
  expect(v.errores).toEqual([]);
});

test('App Check: cada llamada a las funciones del panel real lleva el token en X-Firebase-AppCheck', async ({ page }) => {
  const v = vigilar(page);
  const llamadas: { url: string; token: string | undefined }[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/demo-pruebas/us-east1/')) llamadas.push({ url: r.url(), token: r.headers()['x-firebase-appcheck'] });
  });
  await entrar(page, adm);
  await page.getByRole('link', { name: 'Usuarios' }).click();
  await expect(page.getByText(/Personas con acceso/)).toBeVisible();
  expect(llamadas.length).toBeGreaterThan(0);
  for (const l of llamadas) expect(l.token, l.url).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
  expect(v.errores).toEqual([]);
});

test('venta de punta a punta: turno, terminal, cobro con cambio, recibo, Mis recibos y cierre', async ({ page }) => {
  const v = vigilar(page);
  await entrar(page, sup);
  await expect(page.getByRole('heading', { name: 'Abrir turno' })).toBeVisible();
  await page.getByLabel(/Efectivo inicial en Bolivianos/).fill('100');
  await page.getByRole('button', { name: 'Abrir turno' }).click();
  await expect(page.getByRole('heading', { name: 'Productos' })).toBeVisible();
  await expect(page.getByText(/Cotización: 1 USD = 7 BOB/)).toBeVisible();
  await page.getByLabel(/Buscar por nombre/).fill('hdmi');
  await page.getByRole('button', { name: 'Agregar Cable HDMI 2 m' }).click();
  // 8,00 USD × 7 = Bs 56,00 (BOB con dos decimales).
  await expect(page.locator('[data-prueba="total"]')).toHaveText('Bs 56,00');
  await page.getByRole('button', { name: 'Cobrar' }).click();
  await expect(page.getByRole('heading', { name: 'Cobro' })).toBeVisible();
  await page.getByLabel(/Monto a aplicar/).fill('56');
  await page.getByLabel(/Efectivo recibido/).fill('100');
  await expect(page.locator('[data-prueba="cambio"]')).toHaveText('Bs 44,00');
  await page.getByRole('button', { name: 'Confirmar cobro' }).click();
  await expect(page.getByRole('heading', { name: 'Venta registrada' })).toBeVisible();
  // El recibo lo emite el servidor al consumir el evento.
  await expect(page.getByRole('article', { name: /Recibo A-000001/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Preparar WhatsApp' })).toBeVisible();
  await page.getByRole('link', { name: 'Recibos' }).first().click();
  await expect(page.getByRole('rowheader', { name: 'A-000001' })).toBeVisible();
  await page.goto('/#/venta/cierre');
  await page.getByLabel(/Efectivo contado en BOB/).fill('156');
  await page.getByRole('button', { name: 'Cerrar turno' }).click();
  await page.getByRole('button', { name: 'Sí, cerrar turno' }).click();
  await expect(page.getByRole('heading', { name: 'Turno cerrado' })).toBeVisible();
  expect(v.errores).toEqual([]);
});

test('el vendedor abre turno y el terminal muestra la cotización vigente del servidor, sin avisos', async ({ page }) => {
  const v = vigilar(page);
  await entrar(page, caj);
  await page.getByLabel(/Efectivo inicial en Bolivianos/).fill('10');
  await page.getByRole('button', { name: 'Abrir turno' }).click();
  await expect(page.getByRole('heading', { name: 'Productos' })).toBeVisible();
  await expect(page.getByText(/Cotización: 1 USD = 7 BOB/)).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(v.errores).toEqual([]);
});

test('inventario básico: existencias por almacén desde el servidor, ficha con precio del día y conteo ciego', async ({ page }) => {
  const v = vigilar(page);
  await entrar(page, sup);
  await page.getByRole('link', { name: 'Inventario' }).click();
  await expect(page.getByRole('table', { name: 'Productos y existencias por almacén' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Productos y existencias por almacén' })).toContainText('Parlante portátil');
  await page.getByRole('button', { name: 'Ficha de Cable HDMI 2 m' }).click();
  await expect(page.locator('[data-prueba="precio-bo"]')).toContainText('Bs 56,00');
  await page.getByRole('link', { name: 'Conteo ciego' }).click();
  await page.getByRole('button', { name: 'Abrir conteo' }).click();
  await expect(page.getByText(/Conteo abierto en/)).toBeVisible();
  expect(v.errores).toEqual([]);
});

test('catálogo básico: tablero con cotización y uso del plan, usuarios y configuración', async ({ page }) => {
  const v = vigilar(page);
  await entrar(page, adm);
  await page.getByRole('link', { name: 'Catálogo y sitio' }).click();
  await expect(page.getByRole('heading', { name: 'Sitio' })).toBeVisible();
  await expect(page.getByText(/de 200/).first()).toBeVisible();
  await page.getByRole('link', { name: 'Usuarios' }).click();
  await expect(page.getByText(/Personas con acceso/)).toBeVisible();
  await page.getByRole('link', { name: 'Configuración' }).click();
  await expect(page.getByRole('heading', { name: 'Datos del negocio y del POS' })).toBeVisible();
  expect(v.errores).toEqual([]);
});
