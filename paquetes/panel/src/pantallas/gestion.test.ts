// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, render, screen, waitFor, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorApi } from '../api/errores.js';
import { crearEntorno, uuid, type Entorno, type Nodo } from '../ayuda-pruebas.js';
import { PantallaCatalogo } from './consola/catalogo.js';
import { PantallaConfiguracion } from './configuracion.js';
import { PantallaInventario } from './inventarios/inventario.js';
import { PantallaMermas } from './inventarios/mermas.js';
import { PantallaRecibos } from './recibos/recibos.js';
import { PantallaUsuarios } from './usuarios.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ver = (e: Entorno, nodo: Nodo): void => void render(e.envolver(nodo));
const campo = (re: RegExp | string): HTMLElement => screen.getByLabelText(re);

describe('inventario', () => {
  it('la ficha muestra el precio en Bs y ARS del día; el costo y el margen son solo del administrador', async () => {
    const e = crearEntorno('sup');
    ver(e, h(PantallaInventario, { sub: 'productos' }));
    const u = userEvent.setup();
    expect((await screen.findByRole('link', { name: 'Fotos y página en el sitio de Televisor 55 pulgadas' })).getAttribute('href')).toBe('#/catalogo/fichas');
    await u.click(await screen.findByRole('button', { name: 'Datos del producto de Televisor 55 pulgadas' }));
    expect(await screen.findByText(/Solo el administrador edita/)).toBeTruthy();
    expect(document.querySelector('[data-prueba="precio-bo"]')?.textContent).toContain('Bs 3.132,00');
    expect(document.querySelector('[data-prueba="precio-ar"]')?.textContent).toContain('ARS 480.000,00');
    expect(screen.queryByText(/Costo y margen/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).toBeNull();
    cleanup();
    const adm = crearEntorno('adm');
    ver(adm, h(PantallaInventario, { sub: 'productos' }));
    await u.click(await screen.findByRole('button', { name: 'Datos del producto de Televisor 55 pulgadas' }));
    expect(await screen.findByText(/Costo y margen \(solo administrador\)/)).toBeTruthy();
    expect(screen.getByText('33,3 %', { exact: false })).toBeTruthy();
  });

  it('el administrador cambia precio y mínimo de una sola vez', async () => {
    const e = crearEntorno('adm');
    ver(e, h(PantallaInventario, { sub: 'productos' }));
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Datos del producto de Cable HDMI 2 m' }));
    await u.clear(await screen.findByLabelText(/^Bolivia \(USD\)/));
    await u.type(screen.getByLabelText(/^Bolivia \(USD\)/), '10,50');
    await u.clear(screen.getByLabelText('Mínimo de existencias'));
    await u.type(screen.getByLabelText('Mínimo de existencias'), '12');
    await u.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Cambios guardados: Cable HDMI 2 m.')).toBeTruthy();
    const p = (await e.api.llamar('listarProductos', {})).find((x) => x.id === 'cable-hdmi');
    expect(p?.precioUSD.bo).toBe(1050);
    expect(p?.minimo).toBe(12);
  });

  it('un error del servidor en un traspaso se muestra legible', async () => {
    const e = crearEntorno('sup');
    // Las existencias cambiaron entre la vista previa y el envío: el servidor rechaza el traspaso.
    const original = e.api.llamar.bind(e.api);
    vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, en: unknown) => (n === 'traspasar' ? Promise.reject(new ErrorApi('failed-precondition', 'No hay existencias suficientes en el origen.')) : original(n as never, en as never))) as never);
    ver(e, h(PantallaInventario, { sub: 'traspasos' }));
    const u = userEvent.setup();
    const producto = await screen.findByRole('combobox', { name: /^Producto/ });
    await u.click(producto);
    await u.type(producto, 'cable');
    await u.click(await screen.findByRole('option', { name: /Cable HDMI/ }));
    await u.type(screen.getByLabelText(/^Cantidad/), '1');
    await u.click(screen.getByRole('button', { name: 'Traspasar' }));
    const d = await screen.findByRole('dialog', { name: '¿Registrar este traspaso?' });
    await u.click(within(d).getByRole('button', { name: 'Sí, traspasar' }));
    expect((await within(d).findByRole('alert')).textContent).toContain('No hay existencias suficientes');
  });

  it('busca por serie y muestra estado, venta y garantía', async () => {
    const e = crearEntorno('sup');
    await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 0 } });
    await e.api.llamar('confirmarVenta', { requestId: uuid(), carrito: { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'tv-55', cantidad: 1, series: ['TV55-001'] }] }, pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 313200 }] });
    ver(e, h(PantallaInventario, { sub: 'series' }));
    const u = userEvent.setup();
    await u.type(await screen.findByLabelText(/Número de serie/), 'tv55-001');
    await u.click(screen.getByRole('button', { name: 'Buscar' }));
    const tabla = await screen.findByRole('table', { name: 'Resultado de la búsqueda por serie' });
    expect(tabla.textContent).toContain('Vendida');
    expect(tabla.textContent).toContain('2027-11-04');
    await u.clear(screen.getByLabelText(/Número de serie/));
    await u.type(screen.getByLabelText(/Número de serie/), 'zzz');
    await u.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText('No se encontró esa serie')).toBeTruthy();
  });

  it('registro de acciones con filtros y exportación CSV; importar y exportar', async () => {
    const e = crearEntorno('adm');
    await e.api.llamar('ingresar', { operacionId: uuid(), ubicacionId: 'tienda', lineas: [{ productoId: 'cable-hdmi', cantidad: 2 }] });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
    const clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockReturnValue(undefined);
    const u = userEvent.setup();
    ver(e, h(PantallaInventario, { sub: 'registro' }));
    expect(await screen.findByRole('table', { name: 'Movimientos de inventario' })).toBeTruthy();
    await u.selectOptions(screen.getByLabelText('Tipo'), 'venta');
    await u.click(screen.getByRole('button', { name: 'Filtrar' }));
    expect(await screen.findByText('No hay movimientos con esos filtros')).toBeTruthy();
    await u.selectOptions(screen.getByLabelText('Tipo'), '');
    await u.click(screen.getByRole('button', { name: 'Filtrar' }));
    await u.click(await screen.findByRole('button', { name: 'Exportar CSV' }));
    expect(clic).toHaveBeenCalled();
    cleanup();
    ver(e, h(PantallaInventario, { sub: 'csv' }));
    await u.click(await screen.findByRole('button', { name: 'Exportar productos' }));
    expect(await screen.findByText('Archivo exportado.')).toBeTruthy();
    const archivo = new File(['id,nombre,categoria,sku,precioUSDbo,precioUSDar\r\ncsv-1,Del CSV,Cat,C-1,100,110\r\n'], 'p.csv', { type: 'text/csv' });
    await u.upload(screen.getByLabelText('Archivo de productos (CSV o Excel)'), archivo);
    await u.click(await screen.findByRole('button', { name: 'Importar 1 fila' }));
    const d = await screen.findByRole('dialog', { name: '¿Importar este archivo?' });
    await u.click(within(d).getByRole('button', { name: 'Sí, importar' }));
    expect(await screen.findByText(/Importación terminada/, { selector: '.alerta' })).toBeTruthy();
    expect((await e.api.llamar('listarProductos', {})).some((p) => p.id === 'csv-1')).toBe(true);
  });

  it('el supervisor no ve ajuste ni importación', () => {
    const e = crearEntorno('sup');
    ver(e, h(PantallaInventario, { sub: 'ajuste' }));
    expect(screen.queryByRole('link', { name: 'Ajuste' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Importar y exportar' })).toBeTruthy();
  });
});

describe('mermas', () => {
  it('se solicita y la resuelve otra persona', async () => {
    const e = crearEntorno('sup');
    ver(e, h(PantallaMermas, {}));
    const u = userEvent.setup();
    const producto = await screen.findByRole('combobox', { name: /^Producto/ });
    await u.click(producto);
    await u.type(producto, 'cable');
    await u.click(await screen.findByRole('option', { name: /Cable HDMI/ }));
    await u.clear(screen.getByLabelText(/^Cantidad/));
    await u.type(screen.getByLabelText(/^Cantidad/), '2');
    await u.type(screen.getByLabelText(/^Motivo/), 'Cable cortado');
    await u.click(screen.getByRole('button', { name: 'Solicitar merma' }));
    expect(await screen.findByText(/no mueve el stock hasta entonces/)).toBeTruthy();
    expect(await screen.findByText('La resuelve otra persona')).toBeTruthy();
    cleanup();
    e.como('adm');
    ver(e, h(PantallaMermas, {}));
    await u.click(await screen.findByRole('button', { name: 'Aprobar la merma de Cable HDMI 2 m' }));
    await u.click(within(await screen.findByRole('dialog', { name: '¿Aprobar esta merma?' })).getByRole('button', { name: 'Sí, aprobar' }));
    expect(await screen.findByText(/Merma de Cable HDMI 2 m aprobada/)).toBeTruthy();
    expect((await e.api.llamar('listarProductos', {})).find((p) => p.id === 'cable-hdmi')?.existencias.tienda).toBe(23);
  });
});

describe('recibos', () => {
  async function conRecibo() {
    const e = crearEntorno('caj');
    await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 0 } });
    await e.api.llamar('confirmarVenta', { requestId: uuid(), carrito: { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'cable-hdmi', cantidad: 1 }], cliente: { nombre: 'María López', telefono: '71234567' } }, pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 5568 }] });
    return e;
  }
  it('busca por número y cliente, abre el recibo y prepara el enlace de WhatsApp', async () => {
    const e = await conRecibo();
    ver(e, h(PantallaRecibos, {}));
    const u = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'Mis recibos' })).toBeTruthy();
    await u.type(screen.getByLabelText('Cliente'), 'maria lopez');
    await u.click(screen.getByRole('button', { name: 'Buscar' }));
    await u.click(await screen.findByRole('button', { name: 'Ver recibo A-000001' }));
    expect(await screen.findByRole('article', { name: 'Recibo A-000001' })).toBeTruthy();
    expect(screen.queryByLabelText('N.º de factura SUMA')).toBeNull(); // el vendedor no la referencia
    await u.click(screen.getByRole('button', { name: 'Preparar WhatsApp' }));
    const enlace = await screen.findByRole('link', { name: /Abrir WhatsApp/ });
    expect(enlace.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/59171234567\?text=/);
    expect(enlace.getAttribute('rel')).toContain('noopener');
    const imprimir = vi.fn();
    window.print = imprimir;
    await u.click(screen.getByRole('button', { name: 'Imprimir' }));
    expect(imprimir).toHaveBeenCalled();
    await u.clear(screen.getByLabelText('Cliente'));
    await u.type(screen.getByLabelText('Cliente'), 'nadie');
    await u.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText('No hay recibos que coincidan')).toBeTruthy();
  });
  it('el supervisor referencia la factura SUMA', async () => {
    const e = await conRecibo();
    e.como('sup');
    ver(e, h(PantallaRecibos, {}));
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Ver recibo A-000001' }));
    await u.type(await screen.findByLabelText('N.º de factura SUMA'), 'F-2026/55');
    await u.click(screen.getByRole('button', { name: 'Guardar referencia' }));
    expect(await screen.findByText('Referencia de factura guardada.')).toBeTruthy();
    expect(await screen.findByText(/Factura SUMA N.º F-2026\/55/)).toBeTruthy();
    await u.clear(screen.getByLabelText('N.º de factura SUMA'));
    await u.type(screen.getByLabelText('N.º de factura SUMA'), '<b>');
    await u.click(screen.getByRole('button', { name: 'Guardar referencia' }));
    expect((await screen.findAllByRole('alert'))[0]?.textContent).toContain('Hay datos que no son válidos');
  });
  it('el texto del cliente se escapa: no se interpreta como HTML', async () => {
    const e = crearEntorno('caj');
    await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 0 } });
    await e.api.llamar('confirmarVenta', { requestId: uuid(), carrito: { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'cable-hdmi', cantidad: 1 }], cliente: { nombre: '<img src=x onerror=alert(1)>' } }, pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 5568 }] });
    ver(e, h(PantallaRecibos, {}));
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Ver recibo A-000001' }));
    const art = await screen.findByRole('article', { name: 'Recibo A-000001' });
    expect(art.querySelector('img')).toBeNull();
    expect(art.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('usuarios y configuración', () => {
  it('cambia el rol de un usuario y quita otro con confirmación en la página; no permite tocar al administrador', async () => {
    const e = crearEntorno('adm');
    ver(e, h(PantallaUsuarios, {}));
    const u = userEvent.setup();
    expect(await screen.findByText('Personas con acceso (3 de 3)')).toBeTruthy();
    await u.selectOptions(screen.getByLabelText('Rol de caj@ejemplo.test'), 'sup');
    await u.click(screen.getAllByRole('button', { name: 'Guardar rol' })[1] as HTMLElement);
    expect(await screen.findByText(/Rol actualizado/)).toBeTruthy();
    const confirmar = vi.spyOn(window, 'confirm');
    await u.click(screen.getAllByRole('button', { name: 'Quitar acceso' })[0] as HTMLElement);
    expect(await screen.findByText(/¿Quitar el acceso de/)).toBeTruthy();
    expect(confirmar).not.toHaveBeenCalled();
    await u.click(screen.getByRole('button', { name: 'Sí, quitar' }));
    expect(await screen.findByText('Acceso retirado.')).toBeTruthy();
    expect(await screen.findByText('Personas con acceso (2 de 3)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Quitar acceso de adm' })).toBeNull();
  });
  it('alta: con el plan lleno avisa el tope y no ofrece buscar; al quitar a alguien se habilita', async () => {
    const e = crearEntorno('adm');
    ver(e, h(PantallaUsuarios, {}));
    const u = userEvent.setup();
    expect(await screen.findByText(/ya están todos ocupados/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Buscar cuenta' })).toBeNull();
    await u.click(screen.getAllByRole('button', { name: 'Quitar acceso' })[0] as HTMLElement);
    await u.click(screen.getByRole('button', { name: 'Sí, quitar' }));
    expect(await screen.findByRole('button', { name: 'Buscar cuenta' })).toBeTruthy();
  });
  it('alta: cuenta existente con correo verificado → asigna el rol elegido', async () => {
    const e = crearEntorno('adm');
    await e.api.llamar('quitarRol', { uid: 'u-sup' });
    ver(e, h(PantallaUsuarios, {}));
    const u = userEvent.setup();
    await u.type(await screen.findByLabelText(/Correo de la persona/), ' Nueva@Ejemplo.test ');
    await u.selectOptions(screen.getByLabelText('Rol que tendrá'), 'sup');
    await u.click(screen.getByRole('button', { name: 'Buscar cuenta' }));
    expect(await screen.findByText(/Cuenta encontrada y con el correo verificado/)).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Asignar rol de supervisor' }));
    expect(await screen.findByText(/nueva@ejemplo.test ahora es supervisor/)).toBeTruthy();
    expect(await screen.findByText('Personas con acceso (3 de 3)')).toBeTruthy();
    expect((await e.api.llamar('listarUsuarios', {})).find((x) => x.uid === 'u-nueva')?.rol).toBe('sup');
  });
  it('alta: cuenta sin verificar pide verificar el correo y no ofrece asignar', async () => {
    const e = crearEntorno('adm');
    await e.api.llamar('quitarRol', { uid: 'u-sup' });
    ver(e, h(PantallaUsuarios, {}));
    const u = userEvent.setup();
    await u.type(await screen.findByLabelText(/Correo de la persona/), 'pendiente@ejemplo.test');
    await u.click(screen.getByRole('button', { name: 'Buscar cuenta' }));
    expect(await screen.findByText(/todavía no está verificado/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Asignar rol/ })).toBeNull();
  });
  it('alta: cuenta inexistente muestra las instrucciones para crearla; el panel no crea cuentas', async () => {
    const e = crearEntorno('adm');
    await e.api.llamar('quitarRol', { uid: 'u-sup' });
    ver(e, h(PantallaUsuarios, {}));
    const u = userEvent.setup();
    await u.type(await screen.findByLabelText(/Correo de la persona/), 'nadie@ejemplo.test');
    await u.click(screen.getByRole('button', { name: 'Buscar cuenta' }));
    const pasos = await screen.findByRole('region', { name: 'Cómo crear la cuenta' });
    expect(within(pasos).getAllByRole('listitem')).toHaveLength(4);
    expect(pasos.textContent).toContain('Add user');
    expect(pasos.textContent).toContain('nadie@ejemplo.test');
    expect(pasos.textContent).toContain('Reenviar enlace');
    expect(screen.queryByRole('button', { name: /Asignar rol/ })).toBeNull();
    expect(e.api.llamadas.map((l) => l.nombre)).not.toContain('asignarRol');
  });
  it('quitar acceso: el error de último administrador se muestra con su mensaje', async () => {
    const e = crearEntorno('adm');
    const llamar = e.api.llamar.bind(e.api) as (n: string, x: unknown) => Promise<unknown>;
    vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, x: unknown) =>
      n === 'quitarRol' ? Promise.reject(new ErrorApi('failed-precondition', 'x', { codigo: 'ultimo-adm' })) : llamar(n, x)) as never);
    ver(e, h(PantallaUsuarios, {}));
    const u = userEvent.setup();
    await u.click((await screen.findAllByRole('button', { name: 'Quitar acceso' }))[0] as HTMLElement);
    await u.click(screen.getByRole('button', { name: 'Sí, quitar' }));
    expect((await screen.findByRole('alert')).textContent).toContain('No se puede quitar al último administrador.');
  });
  it('configuración del POS: tope de descuento, medios y serie; valida antes de enviar', async () => {
    const e = crearEntorno('adm');
    ver(e, h(PantallaConfiguracion, { sub: 'negocio' }));
    const u = userEvent.setup();
    await screen.findByRole('heading', { name: 'Datos del negocio y del POS' });
    expect((campo('Vendedor') as HTMLInputElement).value).toBe('5');
    await u.clear(campo('Vendedor'));
    await u.type(campo('Vendedor'), '8,5');
    await u.clear(campo('Supervisor'));
    await u.type(campo('Supervisor'), '200');
    expect(await screen.findByText(/entre 0 y 100/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Guardar configuración' }) as HTMLButtonElement).disabled).toBe(true);
    await u.clear(campo('Supervisor'));
    await u.type(campo('Supervisor'), '50');
    await u.click(screen.getByLabelText('QR'));
    await u.click(screen.getByRole('button', { name: 'Guardar configuración' }));
    expect(await screen.findByText('Configuración guardada.')).toBeTruthy();
    const c = await e.api.llamar('leerConfigPos', {});
    expect(c.topesDescuentoBp).toEqual({ caj: 850, sup: 5000, adm: 10000 });
    expect(c.mediosHabilitados).not.toContain('qr');
  });
  it('plantilla del recibo', async () => {
    const e = crearEntorno('adm');
    ver(e, h(PantallaConfiguracion, { sub: 'recibo' }));
    const u = userEvent.setup();
    await u.type(await screen.findByLabelText('Pie de página'), ' Vuelva pronto.');
    await u.click(screen.getByRole('button', { name: 'Guardar plantilla' }));
    expect(await screen.findByText('Plantilla guardada.')).toBeTruthy();
    expect((await e.api.llamar('leerPlantilla', {})).pie).toContain('Vuelva pronto.');
  });
});

describe('catálogo y sitio', () => {
  it('tablero: cambios sin publicar, cotización vigente, uso del plan y publicar con confirmación', async () => {
    const e = crearEntorno('adm');
    await e.api.llamar('actualizarProducto', { operacionId: crypto.randomUUID(), productoId: 'cable-hdmi', cambios: { nombre: 'Cable HDMI 2,5 m' } });
    ver(e, h(PantallaCatalogo, { sub: 'tablero' }));
    const u = userEvent.setup();
    await screen.findByRole('heading', { name: 'Sitio' });
    expect(document.querySelector('[data-prueba="cambios"]')?.textContent).toBe('1');
    expect(screen.getByText(/BOB\/USD = 6,96 · BCB · .* · vigente/)).toBeTruthy();
    expect(screen.getByText('5 de 200')).toBeTruthy();
    expect(screen.getByText('3 de 3')).toBeTruthy();
    expect(screen.getByText('0 B de 10,0 GB')).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Publicar el sitio' }));
    await u.click(await screen.findByRole('button', { name: 'Sí, publicar' }));
    expect(await screen.findByText(/Publicado: versión 1/)).toBeTruthy();
    await waitFor(() => expect(document.querySelector('[data-prueba="cambios"]')?.textContent).toBe('0'));
  });
  it('el supervisor solo ve tablero y fichas, sin publicar', async () => {
    const e = crearEntorno('sup');
    ver(e, h(PantallaCatalogo, { sub: 'secciones' }));
    expect(await screen.findByText('Solo el administrador publica.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Apariencia' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Fichas, fotos y video' })).toBeTruthy();
  });
  it('secciones: crea una con bloques tipados, la ordena y la elimina con confirmación', async () => {
    const e = crearEntorno('adm');
    ver(e, h(PantallaCatalogo, { sub: 'secciones' }));
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Nueva sección' }));
    await u.type(await screen.findByLabelText(/Título \(texto del menú\)/), 'Cómo comprar');
    await u.click(screen.getByRole('button', { name: '+ Texto' }));
    await u.type(screen.getByLabelText('Título del bloque'), 'Pasos');
    await u.type(screen.getByLabelText(/Párrafos/), 'Elija el producto.\n\nEscriba por WhatsApp.');
    await u.click(screen.getByRole('button', { name: '+ Enlaces' }));
    await u.type(screen.getByLabelText(/Enlaces \(uno por línea/), 'Contacto | /contacto');
    await u.click(screen.getByRole('button', { name: 'Guardar sección' }));
    expect(await screen.findByText('Cómo comprar')).toBeTruthy();
    const s = (await e.api.llamar('listarSecciones', {}))[0];
    expect(s?.id).toBe('como-comprar');
    expect(s?.bloques[0]).toEqual({ tipo: 'texto', titulo: 'Pasos', parrafos: ['Elija el producto.', 'Escriba por WhatsApp.'] });
    await u.click(screen.getByRole('button', { name: 'Eliminar' }));
    await u.click(await screen.findByRole('button', { name: 'Sí, eliminar' }));
    await screen.findByText('Todavía no hay secciones');
  });
  it('apariencia: elige una de las 5 plantillas con vista previa y guarda la configuración', async () => {
    const e = crearEntorno('adm');
    ver(e, h(PantallaCatalogo, { sub: 'apariencia' }));
    const u = userEvent.setup();
    const grupo = await screen.findByRole('group', { name: 'Plantilla activa' });
    expect(within(grupo).getAllByRole('radio')).toHaveLength(5);
    expect(within(grupo).getAllByRole('img').length).toBe(10);
    await u.click(within(grupo).getByRole('radio', { name: /Ciruela/ }));
    await u.clear(screen.getByLabelText(/WhatsApp del asistente/));
    await u.type(screen.getByLabelText(/WhatsApp del asistente/), '59171112222');
    await u.click(screen.getByRole('button', { name: 'Guardar apariencia' }));
    expect(await screen.findByText(/Apariencia guardada/)).toBeTruthy();
    const c = await e.api.llamar('leerConfigSitio', {});
    expect(c?.plantillaActiva).toBe('ciruela');
    expect(c?.whatsappNovuchat).toBe('59171112222');
  });
  it('exportar: el Catálogo ya no importa; exporta y enlaza a la importación de Inventario', async () => {
    const e = crearEntorno('adm');
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
    ver(e, h(PantallaCatalogo, { sub: 'exportar' }));
    const u = userEvent.setup();
    expect(await screen.findByText(/Los productos se crean e importan en Inventario/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ir a la importación de Inventario' }).getAttribute('href')).toBe('#/inventario/csv');
    expect(screen.queryByLabelText('Archivo a importar')).toBeNull();
    await u.click(screen.getByRole('button', { name: 'Exportar productos (CSV)' }));
    expect(await screen.findByText(/productos-sitio\.csv generado/)).toBeTruthy();
  });
});
