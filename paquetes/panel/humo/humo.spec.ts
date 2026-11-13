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
  // Bajo 1024 px el menú está plegado tras el botón «Menú»; desde 1024 px el nav se ve.
  const ancho = page.viewportSize()?.width ?? 1280;
  if (ancho < 1024) await expect(page.getByRole('button', { name: 'Menú', exact: true })).toBeVisible();
  else await expect(page.getByRole('navigation', { name: 'Menú principal' })).toBeVisible();
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
      await expect(page.getByText(/productos bajo el mínimo/)).toBeVisible();
      await sinViolaciones(page, 'inventario');
      await page.getByRole('button', { name: 'Datos del producto de Televisor 55 pulgadas' }).click();
      await expect(page.locator('[data-prueba="precio-bo"]')).toContainText('Bs 3.132,00');
      await sinViolaciones(page, 'ficha de producto');
      await page.getByRole('dialog', { name: 'Datos del producto: Televisor 55 pulgadas' }).getByRole('button', { name: 'Cerrar' }).first().click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
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

    for (const ancho of [1280, 820, 360]) {
      test(`inventario a ${String(ancho)} px: alta y edición en el panel lateral, traspaso y ajuste con confirmación, filtro «bajo el mínimo»`, async ({ page }) => {
        const v = vigilar(page);
        await page.setViewportSize({ width: ancho, height: 800 });
        await entrar(page, 'adm');
        if (ancho < 1024) await page.getByRole('button', { name: 'Menú', exact: true }).click();
        await page.getByRole('link', { name: 'Inventario' }).click();
        const tabla = page.getByRole('table', { name: 'Productos y existencias por almacén' });
        await expect(tabla).toBeVisible();
        const sinDesborde = async (): Promise<void> => {
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
          const ids = await page.evaluate(() => [...document.querySelectorAll('[id]')].map((x) => x.id));
          expect(ids.filter((x, i) => ids.indexOf(x) !== i)).toEqual([]);
        };

        // Alta: guardar vacío marca el error junto al campo; luego se crea.
        await page.getByRole('button', { name: 'Nuevo producto' }).click();
        const alta = page.getByRole('dialog', { name: 'Nuevo producto' });
        await expect(alta).toBeVisible();
        const caja = await alta.boundingBox();
        if (ancho >= 1024) {
          expect(caja?.width ?? 0).toBeLessThan(ancho - 200);
          await expect(tabla).toBeInViewport();
        } else {
          expect(Math.round(caja?.width ?? 0)).toBeGreaterThanOrEqual(ancho - 1);
          expect(Math.round(caja?.height ?? 0)).toBeGreaterThanOrEqual(800 - 1);
        }
        await alta.getByRole('button', { name: 'Crear producto' }).click();
        await expect(alta.getByText('Escriba el nombre del producto.')).toBeVisible();
        await expect(alta.getByLabel(/^Nombre/)).toHaveAttribute('aria-invalid', 'true');
        await sinViolaciones(page, `alta con error a ${String(ancho)} px`);
        await alta.getByLabel(/^Nombre/).fill('Teclado mecánico');
        await alta.getByLabel(/^Categoría/).fill('Accesorios');
        await alta.getByLabel(/^SKU/).fill('TEC-1');
        await alta.getByLabel(/^Bolivia \(USD\)/).fill('15');
        await alta.getByLabel(/^Argentina \(USD\)/).fill('16');
        await sinViolaciones(page, `alta a ${String(ancho)} px`);
        await alta.getByRole('button', { name: 'Crear producto' }).click();
        await expect(page.getByText('Producto creado: Teclado mecánico.')).toBeVisible();
        await expect(alta).toBeHidden();

        // Edición: vaciar un dato advierte antes de guardar.
        await page.getByRole('button', { name: 'Datos del producto de Parlante portátil' }).click();
        const edicion = page.getByRole('dialog', { name: 'Datos del producto: Parlante portátil' });
        await expect(edicion).toBeVisible();
        await edicion.getByLabel('Marca').fill('');
        await edicion.getByRole('button', { name: 'Guardar cambios' }).click();
        const aviso = page.getByRole('dialog', { name: '¿Guardar estos cambios?' });
        await expect(aviso.getByText(/Se quitará del producto la marca/)).toBeVisible();
        await sinViolaciones(page, `advertencia de vaciado a ${String(ancho)} px`);
        await aviso.getByRole('button', { name: 'Sí, guardar' }).click();
        await expect(page.getByText('Cambios guardados: Parlante portátil.')).toBeVisible();
        await expect(edicion).toBeHidden();

        // Desactivar advierte.
        await page.getByRole('button', { name: 'Datos del producto de Cable HDMI 2 m' }).click();
        const ficha = page.getByRole('dialog', { name: 'Datos del producto: Cable HDMI 2 m' });
        await ficha.getByLabel('Activo').uncheck();
        await expect(ficha.getByText(/deja de venderse en caja y sale del sitio/)).toBeVisible();
        await ficha.getByRole('button', { name: 'Guardar cambios' }).click();
        const desactivar = page.getByRole('dialog', { name: '¿Guardar estos cambios?' });
        await expect(desactivar.getByText(/El stock no se pierde/)).toBeVisible();
        await sinViolaciones(page, `advertencia de desactivar a ${String(ancho)} px`);
        await desactivar.getByRole('button', { name: 'Volver a editar' }).click();
        await expect(desactivar).toBeHidden();
        await ficha.getByLabel('Activo').check();
        await ficha.getByRole('button', { name: 'Cancelar' }).click();
        await expect(ficha).toBeHidden();
        await sinDesborde();

        // «Ver» filtra por bajo el mínimo.
        await page.getByRole('button', { name: 'Ver', exact: true }).click();
        await expect(page.getByLabel('Mostrar')).toHaveValue('bajo');
        await expect(tabla.getByText('Parlante portátil')).toBeVisible();
        await expect(tabla.getByText('Cable HDMI 2 m')).toHaveCount(0);
        await sinDesborde();

        // Traspaso con selector buscable y confirmación con resumen.
        await page.getByRole('link', { name: 'Traspasos' }).click();
        await expect(page.getByRole('heading', { name: 'Traspaso entre almacenes' })).toBeVisible();
        await page.getByRole('combobox', { name: /^Producto/ }).pressSequentially('cable');
        await page.getByRole('option', { name: /Cable HDMI/ }).click();
        await page.getByLabel(/^Cantidad/).fill('4');
        await page.getByRole('button', { name: 'Traspasar' }).click();
        const traspaso = page.getByRole('dialog', { name: '¿Registrar este traspaso?' });
        await expect(traspaso.getByText('De Depósito 1 a Tienda:')).toBeVisible();
        await sinViolaciones(page, `confirmación de traspaso a ${String(ancho)} px`);
        await traspaso.getByRole('button', { name: 'Sí, traspasar' }).click();
        await expect(page.getByText(/Traspaso registrado/)).toBeVisible();

        // Ajuste con «quedarán N».
        await page.getByRole('link', { name: 'Ajuste' }).click();
        await expect(page.getByRole('heading', { name: /Ajuste de existencias/ })).toBeVisible();
        await page.getByRole('combobox', { name: /^Producto/ }).pressSequentially('cable');
        await page.getByRole('option', { name: /Cable HDMI/ }).click();
        await page.getByLabel(/^Diferencia/).fill('-2');
        await expect(page.getByText('Hay 29, quedarán 27.')).toBeVisible();
        await page.getByLabel(/^Motivo/).fill('Rotura en depósito');
        await page.getByRole('button', { name: 'Aplicar ajuste' }).click();
        const ajuste = page.getByRole('dialog', { name: '¿Aplicar este ajuste?' });
        await expect(ajuste.getByText(/quedarán 27/)).toBeVisible();
        await sinViolaciones(page, `confirmación de ajuste a ${String(ancho)} px`);
        await ajuste.getByRole('button', { name: 'Sí, aplicar el ajuste' }).click();
        await expect(page.getByText('Ajuste registrado.')).toBeVisible();
        await sinDesborde();
        expect(v.errores).toEqual([]);
      });
    }

    for (const ancho of [1280, 820, 360]) {
      test(`conteo abierto a ${String(ancho)} px: existencias ocultas a supervisor y cajera, venta por serie escrita, rechazo sin cantidad y restitución al cerrar`, async ({ page }) => {
        const v = vigilar(page);
        await page.setViewportSize({ width: ancho, height: 800 });
        const irA = async (nombre: string): Promise<void> => {
          if (ancho < 1024) await page.getByRole('button', { name: 'Menú', exact: true }).click();
          await page.getByRole('link', { name: nombre }).click();
        };
        // El doble vive en la página: se cambia de rol con «Salir» y un inicio de sesión, sin recargar.
        const cambiarA = async (rol: keyof typeof CUENTAS): Promise<void> => {
          if (ancho < 1024) await page.getByRole('button', { name: 'Menú', exact: true }).click();
          await page.getByRole('button', { name: 'Salir' }).click();
          await page.getByLabel('Correo').fill(CUENTAS[rol][0]);
          await page.getByLabel('Contraseña').fill(CUENTAS[rol][1]);
          await page.getByRole('button', { name: 'Entrar' }).click();
          if (ancho < 1024) await expect(page.getByRole('button', { name: 'Menú', exact: true })).toBeVisible();
          else await expect(page.getByRole('navigation', { name: 'Menú principal' })).toBeVisible();
        };
        const sinDesborde = async (): Promise<void> => {
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
          const ids = await page.evaluate(() => [...document.querySelectorAll('[id]')].map((x) => x.id));
          expect(ids.filter((x, i) => ids.indexOf(x) !== i)).toEqual([]);
        };

        // La cajera abre su turno antes del conteo.
        await entrar(page, 'caj');
        await page.getByLabel(/Efectivo inicial en Bolivianos/).fill('100');
        await page.getByRole('button', { name: 'Abrir turno' }).click();
        await expect(page.getByRole('heading', { name: 'Productos' })).toBeVisible();
        await expect(page.getByText(/Tienda: \d/).first()).toBeVisible();

        // El supervisor abre un conteo de la Tienda.
        await cambiarA('sup');
        await irA('Inventario');
        await page.getByRole('link', { name: 'Conteo ciego' }).click();
        await page.getByRole('button', { name: 'Abrir conteo' }).click();
        await expect(page.getByText(/Conteo abierto en/)).toBeVisible();

        // Inventario sin cantidades: aviso, «Oculto» y sin el filtro «Bajo el mínimo».
        await page.getByRole('link', { name: 'Productos y existencias' }).click();
        const tabla = page.getByRole('table', { name: 'Productos y existencias por almacén' });
        await expect(tabla).toBeVisible();
        await expect(page.getByText(/Hay un conteo abierto en Tienda/)).toBeVisible();
        await expect(tabla.getByText('Oculto').first()).toBeVisible();
        await expect(page.getByLabel('Mostrar').locator('option', { hasText: 'Bajo el mínimo' })).toHaveCount(0);
        await expect(page.getByText(/Filtro «Bajo el mínimo»/)).toBeVisible();
        await expect(page.getByText(/productos bajo el mínimo/)).toHaveCount(0);
        await sinViolaciones(page, `inventario con conteo abierto a ${String(ancho)} px`);
        await sinDesborde();

        // La cajera vende sin ver cantidades.
        await cambiarA('caj');
        await page.goto('/#/venta/terminal');
        await expect(page.getByRole('heading', { name: 'Productos' })).toBeVisible();
        await expect(page.getByText(/Hay un conteo abierto en Tienda/)).toBeVisible();
        await expect(page.getByRole('img', { name: 'Oculto mientras hay un conteo abierto' }).first()).toBeVisible();
        expect(await page.locator('body').innerText()).not.toMatch(/Tienda: \d|agotado/i);
        await sinViolaciones(page, `caja con conteo abierto a ${String(ancho)} px`);
        await sinDesborde();
        await page.getByRole('button', { name: 'Agregar Cable HDMI 2 m' }).click();
        await expect(page.locator('[data-prueba="total"]')).toHaveText('Bs 55,68');
        await page.getByRole('button', { name: 'Cobrar' }).click();
        await page.getByLabel(/Monto a aplicar/).fill('55,68');
        await page.getByLabel(/Efectivo recibido/).fill('100');
        await page.getByRole('button', { name: 'Confirmar cobro' }).click();
        await expect(page.getByRole('heading', { name: 'Venta registrada' })).toBeVisible();
        await page.getByRole('button', { name: 'Nueva venta' }).click();

        // Producto con serie: se escribe la unidad; una serie inválida marca el error junto al campo.
        await page.getByRole('button', { name: 'Agregar Televisor 55 pulgadas' }).click();
        await expect(page.getByRole('checkbox')).toHaveCount(0);
        const serie = page.getByLabel(/Serie de la unidad/);
        await serie.fill('NO-EXISTE');
        await serie.press('Enter');
        await expect(page.getByText('Esa serie no existe.')).toBeVisible();
        await expect(serie).toHaveAttribute('aria-invalid', 'true');
        await sinViolaciones(page, `serie inválida a ${String(ancho)} px`);
        await serie.fill('TV55-001');
        await serie.press('Enter');
        await expect(page.getByText('Unidades: 1')).toBeVisible();
        await sinDesborde();

        // Un rechazo por falta de stock no revela la cantidad.
        await page.getByRole('button', { name: 'Agregar Parlante portátil' }).click();
        await page.getByLabel(/^Cantidad/).last().fill('500');
        await page.getByRole('button', { name: 'Cobrar' }).click();
        await page.getByLabel(/Monto a aplicar/).fill('90132');
        await page.getByLabel(/Efectivo recibido/).fill('100000');
        await page.getByRole('button', { name: 'Confirmar cobro' }).click();
        const rechazo = page.getByText(/No alcanza el stock/);
        await expect(rechazo).toBeVisible();
        expect(await rechazo.innerText()).not.toMatch(/hay \d/);

        // Al cerrar el conteo, la cajera vuelve a ver las cantidades.
        await cambiarA('sup');
        await irA('Inventario');
        await page.getByRole('link', { name: 'Conteo ciego' }).click();
        await page.getByRole('button', { name: 'Cerrar y firmar el conteo' }).click();
        await page.getByRole('button', { name: 'Sí, cerrar y firmar' }).click();
        await expect(page.getByText(/Conteo cerrado|Conteos anteriores/).first()).toBeVisible();
        await cambiarA('caj');
        await page.goto('/#/venta/terminal');
        await expect(page.getByRole('heading', { name: 'Productos' })).toBeVisible();
        await expect(page.getByText(/Hay un conteo abierto/)).toHaveCount(0);
        await expect(page.getByText(/Tienda: \d/).first()).toBeVisible();
        await sinViolaciones(page, `caja tras cerrar el conteo a ${String(ancho)} px`);
        expect(v.errores).toEqual([]);
      });
    }

    for (const ancho of [1280, 820, 360]) {
      test(`panel lateral de la ficha a ${String(ancho)} px: subida, error con motivo, guardado, sin desborde e ids únicos`, async ({ page }) => {
        const v = vigilar(page);
        await page.setViewportSize({ width: ancho, height: 800 });
        await entrar(page, 'adm');
        const catalogo = page.getByRole('link', { name: 'Catálogo y sitio' });
        if (ancho < 1024) await page.getByRole('button', { name: 'Menú', exact: true }).click();
        await expect(catalogo).toBeVisible();
        await page.getByRole('link', { name: 'Catálogo y sitio' }).click();
        await page.getByRole('link', { name: 'Fichas, fotos y video' }).click();
        const abrir = page.getByRole('button', { name: 'Fotos y video de Televisor 55 pulgadas' });
        await expect(abrir).toBeVisible();
        await abrir.click();
        const dialogo = page.getByRole('dialog', { name: 'Página en el sitio: Televisor 55 pulgadas' });
        await expect(dialogo).toBeVisible();
        await page.getByLabel('Archivos de fotos').setInputFiles({ name: 'frente.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('imagen de prueba') });
        await expect(page.getByText('frente.jpg: Listo')).toBeVisible();
        await page.getByLabel('Archivos de fotos').setInputFiles({ name: 'gigante.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(16 * 1024 * 1024) });
        await expect(page.locator('.ficha-subida-estado', { hasText: /gigante\.jpg.*pesa .* y el máximo es/ })).toBeVisible();
        const caja = await dialogo.boundingBox();
        if (ancho >= 1024) {
          expect(caja?.width ?? 0).toBeLessThan(ancho - 200);
          await expect(abrir).toBeInViewport();
        } else {
          expect(Math.round(caja?.width ?? 0)).toBeGreaterThanOrEqual(ancho - 1);
          expect(Math.round(caja?.height ?? 0)).toBeGreaterThanOrEqual(800 - 1);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
        const ids = await page.evaluate(() => [...document.querySelectorAll('[id]')].map((x) => x.id));
        expect(ids.filter((x, i) => ids.indexOf(x) !== i)).toEqual([]);
        await sinViolaciones(page, `panel de la ficha a ${String(ancho)} px`);
        await page.getByRole('button', { name: 'Guardar', exact: true }).click();
        await expect(page.getByText(/Página guardada/)).toBeVisible();
        expect(v.errores).toEqual([]);
      });
    }

    for (const ancho of [1280, 820, 360]) {
      test(`Inventario a ${String(ancho)} px: conteo con avance, mermas con motivo, importación con simulación y Catálogo que exporta`, async ({ page }) => {
        const v = vigilar(page);
        await page.setViewportSize({ width: ancho, height: 800 });
        const irA = async (enlace: string): Promise<void> => {
          if (ancho < 1024) {
            const boton = page.getByRole('button', { name: 'Menú', exact: true });
            if ((await boton.getAttribute('aria-expanded')) !== 'true') await boton.click();
          }
          await page.getByRole('link', { name: enlace, exact: true }).click();
          if (ancho < 1024 && (await page.getByRole('button', { name: 'Menú', exact: true }).getAttribute('aria-expanded')) === 'true') await page.keyboard.press('Escape');
        };
        const sinDesborde = async (donde: string): Promise<void> => {
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `desborde en ${donde}`).toBe(true);
          const ids = await page.evaluate(() => [...document.querySelectorAll('[id]')].map((x) => x.id));
          expect(ids.filter((x, i) => ids.indexOf(x) !== i), `ids repetidos en ${donde}`).toEqual([]);
        };

        // Supervisor: conteo ciego con guardado al salir del campo, avance y cierre con el aviso de los que faltan.
        await entrar(page, 'sup');
        await irA('Inventario');
        await page.getByRole('link', { name: 'Conteo ciego' }).click();
        await page.getByRole('button', { name: 'Abrir conteo' }).click();
        await expect(page.getByText(/Conteo abierto en/)).toBeVisible();
        const cantidad = page.getByLabel('Cantidad de Cable HDMI 2 m');
        await cantidad.fill('20');
        await expect(page.getByText(/Hay 1 cantidad sin guardar/)).toBeVisible();
        await cantidad.blur();
        await expect(page.locator('[data-prueba="avance-conteo"]')).toContainText(/Avance: 1 de \d+/);
        await expect(page.getByText('Guardado', { exact: true }).first()).toBeVisible();
        await sinViolaciones(page, `conteo con avance a ${String(ancho)} px`);
        await sinDesborde('conteo');
        await page.getByRole('button', { name: 'Cerrar y firmar el conteo' }).click();
        const cierre = page.getByRole('dialog', { name: '¿Cerrar y firmar el conteo?' });
        await expect(cierre.getByText(/Faltan \d+ productos? por contar\. Los que tengan existencias en el sistema se contarán en 0 y generarán mermas\./)).toBeVisible();
        await sinViolaciones(page, `cierre del conteo a ${String(ancho)} px`);
        await cierre.getByRole('button', { name: 'Sí, cerrar y firmar' }).click();
        await expect(page.getByText(/Conteo cerrado y firmado/).first()).toBeVisible();
        await expect(page.getByRole('table', { name: 'Resultado del conteo' })).toBeVisible();
        await sinDesborde('resultado del conteo');

        // Supervisor: solicita una merma; la resuelve otra persona.
        await irA('Mermas');
        await expect(page.getByRole('heading', { name: 'Mermas', level: 1 })).toBeVisible();
        await page.getByRole('combobox', { name: /^Producto/ }).pressSequentially('cable');
        await page.getByRole('option', { name: /Cable HDMI/ }).click();
        await page.getByLabel(/^Motivo/).fill('Cable cortado');
        await page.getByRole('button', { name: 'Solicitar merma' }).click();
        await expect(page.getByText(/Merma de Cable HDMI 2 m solicitada/)).toBeVisible();
        await expect(page.getByText('La resuelve otra persona').first()).toBeVisible();

        // Administrador: filtra por estado y rechaza con motivo.
        if (ancho < 1024) await page.getByRole('button', { name: 'Menú', exact: true }).click();
        await page.getByRole('button', { name: 'Salir', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
        // Sin recargar: el doble vive en memoria y la merma solicitada debe seguir ahí.
        await page.getByLabel('Correo').fill(CUENTAS.adm[0]);
        await page.getByLabel('Contraseña').fill(CUENTAS.adm[1]);
        await page.getByRole('button', { name: 'Entrar' }).click();
        await irA('Mermas');
        const rechazar = page.getByRole('button', { name: 'Rechazar la merma de Cable HDMI 2 m' });
        await expect(rechazar.first()).toBeVisible();
        await page.getByLabel('Estado').selectOption('aprobada');
        await expect(rechazar).toHaveCount(0);
        await page.getByLabel('Estado').selectOption('solicitada');
        await rechazar.first().click();
        const dRechazo = page.getByRole('dialog', { name: '¿Rechazar esta merma?' });
        await dRechazo.getByRole('button', { name: 'Sí, rechazar' }).click();
        await expect(dRechazo.getByText('Error: Escriba por qué rechaza la merma.')).toBeVisible();
        await dRechazo.getByLabel(/^Motivo del rechazo/).fill('Está en buen estado');
        await sinViolaciones(page, `rechazo de merma a ${String(ancho)} px`);
        await dRechazo.getByRole('button', { name: 'Sí, rechazar' }).click();
        await expect(dRechazo).toBeHidden();
        await page.getByLabel('Estado').selectOption('rechazada');
        await expect(page.getByText('Está en buen estado').first()).toBeVisible();
        await sinViolaciones(page, `mermas rechazadas a ${String(ancho)} px`);
        await sinDesborde('mermas');

        // Importación: simulación con una fila con error, importar solo las válidas, confirmar y ver el resultado.
        await irA('Inventario');
        await page.getByRole('link', { name: 'Importar y exportar' }).click();
        await expect(page.getByRole('heading', { name: 'Importar productos' })).toBeVisible();
        const csv = 'id,nombre,categoria,sku,precioBO,precioAR\r\nnuevo-a,Nuevo A,Cat,NA-1,10.50,11\r\nnuevo-b,Nuevo B,Cat,NB-1,20,22.25\r\nnuevo-c,Nuevo C,Cat,,5,6\r\n';
        await page.getByLabel('Archivo de productos (CSV o Excel)').setInputFiles({ name: 'productos.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
        await expect(page.getByText('2 se crearán, 0 se actualizarán, 0 sin cambios, 1 con error.').first()).toBeVisible();
        const simulacion = page.getByRole('table', { name: 'Simulación de la importación' });
        await expect(simulacion).toBeVisible();
        await expect(simulacion.getByText(/Columna «sku»: es obligatorio para crear/)).toBeVisible();
        await sinViolaciones(page, `simulación a ${String(ancho)} px`);
        await sinDesborde('simulación');
        await page.getByRole('button', { name: 'Importar las filas válidas y omitir las 1 con error' }).click();
        const confirmar = page.getByRole('dialog', { name: '¿Importar solo las filas válidas?' });
        await expect(confirmar.getByText(/se omiten 1 fila con error/)).toBeVisible();
        await sinViolaciones(page, `confirmación de importación a ${String(ancho)} px`);
        await confirmar.getByRole('button', { name: 'Sí, importar y omitir las filas con error' }).click();
        await expect(page.getByText(/Importación terminada: 2 productos creados/).first()).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Resultado de la importación' })).toBeVisible();
        await sinDesborde('resultado de la importación');

        // Catálogo: ya no importa; exporta y enlaza a Inventario.
        await irA('Catálogo y sitio');
        await page.getByRole('link', { name: 'Exportar', exact: true }).click();
        await expect(page.getByText(/Los productos se crean e importan en Inventario/)).toBeVisible();
        await expect(page.getByRole('button', { name: 'Exportar productos (CSV)' })).toBeVisible();
        await expect(page.getByLabel('Archivo a importar')).toHaveCount(0);
        await sinViolaciones(page, `exportar del catálogo a ${String(ancho)} px`);
        await sinDesborde('exportar del catálogo');
        await page.getByRole('link', { name: 'Ir a la importación de Inventario' }).click();
        await expect(page).toHaveURL(/#\/inventario\/csv$/);
        await expect(page.getByRole('heading', { name: 'Importar productos' })).toBeVisible();
        expect(v.errores).toEqual([]);
      });
    }

    test('catálogo básico: tablero, ficha con subida de foto, apariencia con vista previa y configuración', async ({ page }) => {
      const v = vigilar(page);
      await entrar(page, 'adm');
      await page.getByRole('link', { name: 'Catálogo y sitio' }).click();
      await expect(page.getByRole('heading', { name: 'Sitio', exact: true })).toBeVisible();
      await expect(page.getByText(/de 200/).first()).toBeVisible();
      await sinViolaciones(page, 'tablero');
      await page.getByRole('link', { name: 'Fichas, fotos y video' }).click();
      await page.getByRole('button', { name: 'Fotos y video de Televisor 55 pulgadas' }).click();
      await expect(page.getByRole('dialog', { name: 'Página en el sitio: Televisor 55 pulgadas' })).toBeVisible();
      await page.getByLabel('Archivos de fotos').setInputFiles({ name: 'frente.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('imagen de prueba') });
      await expect(page.getByText('frente.jpg: Listo')).toBeVisible();
      await sinViolaciones(page, 'panel de la ficha');
      await page.getByRole('button', { name: 'Guardar', exact: true }).click();
      await expect(page.getByText(/Página guardada/)).toBeVisible();
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

    for (const [ancho, alto] of [[360, 740], [820, 1180]] as const) {
      test(`cabecera plegable a ${ancho} px: botón «Menú», Esc devuelve el foco, sin desborde y accesible`, async ({ page }) => {
        const v = vigilar(page);
        await page.setViewportSize({ width: ancho, height: alto });
        await entrar(page, 'adm');
        const boton = page.getByRole('button', { name: 'Menú', exact: true });
        const nav = page.getByRole('navigation', { name: 'Menú principal' });
        const sinDesborde = async (): Promise<void> => {
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        };
        await expect(boton).toHaveAttribute('aria-expanded', 'false');
        await expect(nav).toBeHidden();
        await sinDesborde();
        await sinViolaciones(page, `menú cerrado a ${ancho} px`);
        await boton.click();
        await expect(boton).toHaveAttribute('aria-expanded', 'true');
        await expect(nav).toBeVisible();
        await sinDesborde();
        await sinViolaciones(page, `menú abierto a ${ancho} px`);
        await page.keyboard.press('Escape');
        await expect(boton).toHaveAttribute('aria-expanded', 'false');
        await expect(nav).toBeHidden();
        await expect(boton).toBeFocused();
        expect(v.errores).toEqual([]);
      });
    }

    test('cabecera a 1280 px: el menú se ve sin botón «Menú»', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await entrar(page, 'adm');
      await expect(page.getByRole('navigation', { name: 'Menú principal' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Menú', exact: true })).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await sinViolaciones(page, 'cabecera a 1280 px');
    });

    test('Usuarios: tabla con búsqueda y orden a 1280 px, y sin desborde a 360 px', async ({ page }) => {
      const v = vigilar(page);
      await entrar(page, 'adm');
      await page.getByRole('link', { name: 'Usuarios' }).click();
      const tabla = page.getByRole('table', { name: 'Usuarios del negocio' });
      await expect(tabla).toBeVisible();
      await expect(tabla.getByRole('columnheader', { name: 'Correo' })).toHaveAttribute('scope', 'col');
      await tabla.getByRole('columnheader', { name: 'Correo' }).getByRole('button').click();
      await expect(tabla.getByRole('columnheader', { name: 'Correo' })).toHaveAttribute('aria-sort', 'ascending');
      await sinViolaciones(page, 'usuarios con tabla a 1280');
      expect(await page.content()).not.toMatch(/\sstyle=/);
      await page.setViewportSize({ width: 360, height: 740 });
      await expect(page.getByRole('button', { name: 'Quitar acceso' }).first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
      await sinViolaciones(page, 'usuarios con tabla en modo desplazar a 360');
      expect(v.errores).toEqual([]);
    });

    test('celular 360×740 con un diálogo abierto: cubre la pantalla, no desborda y vive en body', async ({ page }) => {
      const v = vigilar(page);
      await page.setViewportSize({ width: 360, height: 740 });
      await entrar(page, 'adm');
      const quitar = page.getByRole('button', { name: 'Quitar acceso' }).first();
      await page.goto('/#/usuarios');
      await expect(quitar).toBeVisible();
      const anchoAntes = await page.evaluate(() => document.documentElement.scrollWidth);
      await quitar.click();
      const dialogo = page.getByRole('dialog');
      await expect(dialogo).toBeVisible();
      const caja = await dialogo.boundingBox();
      expect(caja).not.toBeNull();
      expect(Math.round(caja?.width ?? 0)).toBe(360);
      expect(Math.round(caja?.height ?? 0)).toBe(740);
      // El diálogo (fixed) no agrega ancho a la página.
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(anchoAntes);
      expect(await dialogo.evaluate((d) => d.closest('.dialogo-fondo')?.parentElement === document.body || d.closest('.dialogo-fondo')?.parentElement?.parentElement === document.body)).toBe(true);
      await sinViolaciones(page, 'diálogo en celular');
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
