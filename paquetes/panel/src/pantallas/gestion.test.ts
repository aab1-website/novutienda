// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorApi } from '../api/errores.js';
import { crearEntorno, uuid, type Entorno, type Nodo } from '../ayuda-pruebas.js';
import { PantallaCatalogo } from './catalogo.js';
import { PantallaConfiguracion } from './configuracion.js';
import { PantallaInventario } from './inventario.js';
import { PantallaMermas } from './mermas.js';
import { PantallaRecibos } from './recibos.js';
import { PantallaUsuarios } from './usuarios.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ver = (e: Entorno, nodo: Nodo): void => void render(e.envolver(nodo));
const campo = (re: RegExp | string): HTMLElement => screen.getByLabelText(re);

describe('inventario', () => {
  it('lista productos con existencias por almacén y alerta de mínimo', async () => {
    const e = crearEntorno('sup');
    ver(e, h(PantallaInventario, { sub: 'productos' }));
    const tabla = await screen.findByRole('table', { name: 'Productos y existencias por almacén' });
    expect(within(tabla).getByText('Televisor 55 pulgadas')).toBeTruthy();
    expect(screen.getByText(/Alerta de mínimo: .*Parlante portátil/)).toBeTruthy();
    expect(within(tabla).getAllByText('Bajo el mínimo').length).toBeGreaterThan(0);
    const u = userEvent.setup();
    await u.click(screen.getByLabelText('Solo bajo el mínimo'));
    expect(within(tabla).queryByText('Cable HDMI 2 m')).toBeNull();
  });

  it('la ficha muestra el precio en Bs y ARS del día; el costo y el margen son solo del administrador', async () => {
    const e = crearEntorno('sup');
    ver(e, h(PantallaInventario, { sub: 'productos' }));
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Ver ficha de Televisor 55 pulgadas' }));
    expect(await screen.findByText(/Solo el administrador edita/)).toBeTruthy();
    expect(document.querySelector('[data-prueba="precio-bo"]')?.textContent).toContain('Bs 3.132,00');
    expect(document.querySelector('[data-prueba="precio-ar"]')?.textContent).toContain('ARS 480.000,00');
    expect(screen.queryByText(/Costo y margen/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).toBeNull();
    cleanup();
    const adm = crearEntorno('adm');
    ver(adm, h(PantallaInventario, { sub: 'productos' }));
    await u.click(await screen.findByRole('button', { name: 'Ver ficha de Televisor 55 pulgadas' }));
    expect(await screen.findByText(/Costo y margen \(solo administrador\)/)).toBeTruthy();
    expect(screen.getByText('33,3 %', { exact: false })).toBeTruthy();
  });

  it('el administrador edita precio y datos desde la ficha y crea productos', async () => {
    const e = crearEntorno('adm');
    ver(e, h(PantallaInventario, { sub: 'productos' }));
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Ver ficha de Cable HDMI 2 m' }));
    await u.clear(await screen.findByLabelText(/^Bolivia \(USD\)/));
    await u.type(screen.getByLabelText(/^Bolivia \(USD\)/), '10,50');
    await u.clear(screen.getByLabelText('Mínimo de existencias'));
    await u.type(screen.getByLabelText('Mínimo de existencias'), '12');
    await u.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Producto guardado.')).toBeTruthy();
    const p = (await e.api.llamar('listarProductos', {})).find((x) => x.id === 'cable-hdmi');
    expect(p?.precioUSD.bo).toBe(1050);
    expect(p?.minimo).toBe(12);
    await u.click(screen.getByRole('button', { name: 'Nuevo producto' }));
    await u.type(await screen.findByLabelText(/Identificador/), 'teclado-1');
    await u.type(screen.getByLabelText(/^Nombre/), 'Teclado');
    await u.type(screen.getByLabelText(/^Categoría/), 'Accesorios');
    await u.type(screen.getByLabelText(/^SKU/), 'TEC-1');
    await u.type(screen.getByLabelText(/^Bolivia \(USD\)/), '15');
    await u.type(screen.getByLabelText(/^Argentina \(USD\)/), '16');
    await u.click(screen.getByRole('button', { name: 'Crear producto' }));
    await waitFor(async () => expect((await e.api.llamar('listarProductos', {})).some((x) => x.id === 'teclado-1')).toBe(true));
  });

  it('ingreso con series, traspaso y ajuste (solo administrador)', async () => {
    const e = crearEntorno('adm');
    const u = userEvent.setup();
    ver(e, h(PantallaInventario, { sub: 'ingreso' }));
    await screen.findByRole('heading', { name: 'Ingreso de mercadería' });
    await u.selectOptions(await screen.findByLabelText('Producto'), 'cel-a1');
    await u.type(screen.getByLabelText(/Series \(una por unidad/), 'N-100, N-101');
    await u.click(screen.getByRole('button', { name: 'Registrar ingreso' }));
    expect(await screen.findByText('Ingreso registrado.')).toBeTruthy();
    expect((await e.api.llamar('buscarSerie', { serie: 'N-10' })).length).toBe(2);
    cleanup();
    ver(e, h(PantallaInventario, { sub: 'traspasos' }));
    await screen.findByRole('heading', { name: 'Traspaso entre almacenes' });
    await u.selectOptions(await screen.findByLabelText('Producto'), 'cable-hdmi');
    await u.clear(screen.getByLabelText(/^Cantidad/));
    await u.type(screen.getByLabelText(/^Cantidad/), '4');
    await u.click(screen.getByRole('button', { name: 'Traspasar' }));
    expect(await screen.findByText(/Traspaso registrado/)).toBeTruthy();
    cleanup();
    ver(e, h(PantallaInventario, { sub: 'ajuste' }));
    await u.selectOptions(await screen.findByLabelText('Producto'), 'cable-hdmi');
    await u.type(await screen.findByLabelText(/Diferencia/), '-2');
    await u.type(screen.getByLabelText(/^Motivo/), 'Rotura en depósito');
    await u.click(screen.getByRole('button', { name: 'Aplicar ajuste' }));
    expect(await screen.findByText('Ajuste registrado.')).toBeTruthy();
    expect((await e.api.llamar('listarProductos', {})).find((p) => p.id === 'cable-hdmi')?.stockTotal).toBe(33);
  });

  it('un error del servidor en un traspaso se muestra legible', async () => {
    const e = crearEntorno('sup');
    ver(e, h(PantallaInventario, { sub: 'traspasos' }));
    const u = userEvent.setup();
    await u.selectOptions(await screen.findByLabelText('Origen'), 'deposito-2');
    await u.selectOptions(screen.getByLabelText('Producto'), 'cable-hdmi');
    await u.click(screen.getByRole('button', { name: 'Traspasar' }));
    expect((await screen.findByRole('alert')).textContent).toContain('No hay existencias suficientes');
  });

  it('conteo ciego: quien cuenta no ve el teórico; al cerrar se muestran las diferencias', async () => {
    const e = crearEntorno('sup');
    ver(e, h(PantallaInventario, { sub: 'conteo' }));
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Abrir conteo' }));
    await screen.findByText(/Conteo abierto en/);
    expect(screen.queryByRole('columnheader', { name: 'Sistema' })).toBeNull();
    await u.type(screen.getByLabelText('Cantidad de Cable HDMI 2 m'), '20');
    await u.click(within(screen.getByText('Cable HDMI 2 m').closest('tr') as HTMLElement).getByRole('button', { name: 'Registrar' }));
    expect(await screen.findByText(/contado: 20/)).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Cerrar y firmar el conteo' }));
    await u.click(await screen.findByRole('button', { name: 'Sí, cerrar y firmar' }));
    const tabla = await screen.findByRole('table', { name: 'Resultado del conteo' });
    expect(tabla.textContent).toContain('-5');
    expect(await screen.findByText(/Conteo cerrado y firmado/)).toBeTruthy();
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
    await u.upload(screen.getByLabelText('Archivo CSV a importar'), archivo);
    expect(await screen.findByText(/1 productos creados/)).toBeTruthy();
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
    await u.selectOptions(await screen.findByLabelText('Producto'), 'cable-hdmi');
    await u.clear(screen.getByLabelText(/^Cantidad/));
    await u.type(screen.getByLabelText(/^Cantidad/), '2');
    await u.type(screen.getByLabelText(/^Motivo/), 'Cable cortado');
    await u.click(screen.getByRole('button', { name: 'Solicitar merma' }));
    expect(await screen.findByText(/no mueve el stock hasta entonces/)).toBeTruthy();
    expect(await screen.findByText('La resuelve otra persona')).toBeTruthy();
    cleanup();
    e.como('adm');
    ver(e, h(PantallaMermas, {}));
    await u.click(await screen.findByRole('button', { name: 'Aprobar' }));
    expect(await screen.findByText('Aprobada')).toBeTruthy();
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
    expect((await screen.findAllByRole('alert'))[0]?.textContent).toContain('facturaSuma inválida');
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
  it('ficha: sube una foto con progreso, la guarda con texto alternativo y respeta el tope de 5', async () => {
    const e = crearEntorno('sup');
    ver(e, h(PantallaCatalogo, { sub: 'fichas' }));
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Editar la ficha de Televisor 55 pulgadas' }));
    await screen.findByRole('heading', { name: 'Ficha web: Televisor 55 pulgadas' });
    const foto = new File(['x'.repeat(2048)], 'frente.jpg', { type: 'image/jpeg' });
    fireEvent.change(await screen.findByLabelText('Subir fotos'), { target: { files: [foto] } });
    expect(await screen.findByText('frente.jpg: Listo')).toBeTruthy();
    expect(e.almacen.subidos).toHaveLength(1);
    expect(e.almacen.subidos[0]?.ruta).toContain('privado/tv-55/');
    // El disparador resolvió la subida: el panel solo consultó el estado, sin forzar el procesamiento (no hay doble procesamiento).
    expect(e.api.llamadas.some((l) => l.nombre === 'estadoSubida')).toBe(true);
    expect(e.api.llamadas.some((l) => l.nombre === 'finalizarSubida')).toBe(false);
    expect(await screen.findByText(/Portada \(2 KB\)/)).toBeTruthy();
    await u.type(screen.getByLabelText('Descripción del producto'), 'Televisor de 55 pulgadas.');
    await u.click(screen.getByRole('button', { name: 'Guardar ficha' }));
    expect(await screen.findByText(/Ficha guardada/)).toBeTruthy();
    expect((await e.api.llamar('listarFichas', {}))[0]?.ficha.medios[0]?.alt).toBe('frente');
    // Tope de 5 fotos: la sexta falla con mensaje legible.
    for (let i = 0; i < 4; i++) fireEvent.change(screen.getByLabelText('Subir fotos'), { target: { files: [new File(['x'], `f${i}.jpg`, { type: 'image/jpeg' })] } });
    await waitFor(() => expect((screen.getByLabelText('Subir fotos') as HTMLInputElement).disabled).toBe(true));
  });
  it('ficha: si el servidor rechaza el archivo, muestra el error y no agrega el medio', async () => {
    const e = crearEntorno('sup');
    e.api.estado.disparador.rechazo = 'El archivo no es una imagen válida';
    ver(e, h(PantallaCatalogo, { sub: 'fichas' }));
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Editar la ficha de Televisor 55 pulgadas' }));
    fireEvent.change(await screen.findByLabelText('Subir fotos'), { target: { files: [new File(['x'], 'roto.jpg', { type: 'image/jpeg' })] } });
    expect(await screen.findByText('roto.jpg: No se pudo procesar el archivo. Pruebe con otro.')).toBeTruthy();
    expect(e.api.llamadas.some((l) => l.nombre === 'finalizarSubida')).toBe(false);
    expect(await e.api.llamar('listarMedios', { productoId: 'tv-55' })).toHaveLength(0);
  });
  it('ficha: un video, reordenar y quitar de la ficha', async () => {
    const e = crearEntorno('sup');
    ver(e, h(PantallaCatalogo, { sub: 'fichas' }));
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Editar la ficha de Cable HDMI 2 m' }));
    fireEvent.change(await screen.findByLabelText('Subir fotos'), { target: { files: [new File(['a'], 'uno.jpg', { type: 'image/jpeg' }), new File(['b'], 'dos.jpg', { type: 'image/jpeg' })] } });
    await screen.findByText('uno.jpg: Listo');
    await screen.findByText('dos.jpg: Listo');
    fireEvent.change(screen.getByLabelText('Subir video'), { target: { files: [new File(['v'], 'demo.mp4', { type: 'video/mp4' })] } });
    await screen.findByText('demo.mp4: Listo');
    await waitFor(() => expect((screen.getByLabelText('Subir video') as HTMLInputElement).disabled).toBe(true));
    const primero = screen.getByLabelText('Texto alternativo del medio 1') as HTMLInputElement;
    const textoAntes = primero.value;
    await u.click(screen.getByRole('button', { name: 'Bajar el medio 1' }));
    expect((screen.getByLabelText('Texto alternativo del medio 2') as HTMLInputElement).value).toBe(textoAntes);
    await u.click(screen.getByRole('button', { name: 'Quitar de la ficha el medio 1' }));
    expect(screen.queryByLabelText('Texto alternativo del medio 3')).toBeNull();
  });
  it('ficha: un archivo demasiado grande se informa sin romper la pantalla', async () => {
    const e = crearEntorno('sup');
    ver(e, h(PantallaCatalogo, { sub: 'fichas' }));
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Editar la ficha de Cable HDMI 2 m' }));
    const enorme = new File(['x'], 'gigante.jpg', { type: 'image/jpeg' });
    Object.defineProperty(enorme, 'size', { value: 16 * 1024 * 1024 });
    fireEvent.change(await screen.findByLabelText('Subir fotos'), { target: { files: [enorme] } });
    expect(await screen.findByText(/gigante.jpg: Se alcanzó un límite del plan/)).toBeTruthy();
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
  it('importación: simula, bloquea con errores y permite omitirlos', async () => {
    const e = crearEntorno('adm');
    ver(e, h(PantallaCatalogo, { sub: 'importar' }));
    const u = userEvent.setup();
    const csv = 'id,nombre,categoria,sku,precioBO,precioAR,stock\r\nok-1,Uno,Cat,S1,10,11,50\r\nMAL ID,Dos,Cat,S2,1,1,1\r\n';
    await u.upload(await screen.findByLabelText('Archivo a importar'), new File([csv], 'p.csv', { type: 'text/csv' }));
    expect(await screen.findByText(/por crear/)).toBeTruthy();
    expect(screen.getByText(/el CSV no modifica el stock/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Importar' }) as HTMLButtonElement).disabled).toBe(true);
    await u.click(screen.getByLabelText('Importar omitiendo las filas con error'));
    await u.click(screen.getByRole('button', { name: 'Importar' }));
    expect(await screen.findByText('Importadas 1 filas.')).toBeTruthy();
  });
});
