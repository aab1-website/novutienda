// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, render, screen, waitFor, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { MovimientoVista, Rol, UsuarioVista } from '../../api/tipos.js';
import { crearEntorno, uuid, type Entorno } from '../../ayuda-pruebas.js';
import { ProveedorGuardia } from '../../ui/guardia.js';
import { PantallaInventario, separarSub } from './inventario.js';
import { PantallaMermas } from './mermas.js';
import { enlaceMovimientos, textoExistenciaActual } from './mermas-logica.js';
import { ENCABEZADOS_CSV_MOVIMIENTOS, filasCsvMovimientos, quienFue } from './registro.js';
import { textoSerieOculta } from './series.js';
import { columnasArchivo } from './importar-logica.js';

afterEach(cleanup);

const producto = { id: 'cable-hdmi', sku: 'CAB-1' } as never;
const mov: MovimientoVista = { id: 'm1', operacionId: 'o', series: ['SN-1', 'SN-2'], tipo: 'ingreso', productoId: 'cable-hdmi', ubicacionId: 'tienda', delta: 2, por: 'u-sup', rol: 'sup', fecha: '2026-11-04T10:00:00Z' };
const usuarios: UsuarioVista[] = [{ uid: 'u-sup', correo: 'ana@ejemplo.test', rol: 'sup', verificado: true }];

async function conConteo(rol: Rol): Promise<Entorno> {
  const e = crearEntorno('sup');
  await e.api.llamar('abrirConteo', { operacionId: uuid(), conteoId: 'conteo-tienda', ubicacionId: 'tienda' });
  e.como(rol);
  return e;
}

describe('4.4.1 registro: SKU, series y usuario', () => {
  it('paso 24: el CSV es legible: fecha, producto, SKU, tipo, almacén, Entrada/Salida y usuario', () => {
    expect(ENCABEZADOS_CSV_MOVIMIENTOS).toEqual(['Fecha', 'Tipo', 'Producto', 'SKU', 'Almacén', 'Cantidad', 'Entrada/Salida', 'Saldo', 'Series', 'Usuario', 'Motivo']);
    const [fila] = filasCsvMovimientos([mov], [{ id: 'cable-hdmi', sku: 'CAB-1', nombre: 'Cable HDMI' } as never], usuarios);
    expect(fila?.slice(0, 7)).toEqual(['04/11/2026 06:00', 'Ingreso', 'Cable HDMI', 'CAB-1', 'Tienda', 2, 'Entrada']);
    expect(fila?.slice(8)).toEqual(['SN-1 SN-2', 'ana@ejemplo.test (sup)', undefined]);
    expect(filasCsvMovimientos([{ ...mov, delta: -1 }], [producto], usuarios)[0]?.[6]).toBe('Salida');
  });
  it('el usuario sale con su correo y, si no se sabe, con el uid y el rol', () => {
    expect(quienFue(mov, usuarios)).toBe('ana@ejemplo.test (sup)');
    expect(quienFue(mov, [])).toBe('u-sup (sup)');
  });
  it('la tabla muestra las columnas SKU y Series', async () => {
    const e = crearEntorno('adm');
    await e.api.llamar('ingresar', { operacionId: 'op-1', ubicacionId: 'tienda', lineas: [{ productoId: 'cable-hdmi', cantidad: 2 }] });
    render(e.envolver(h(ProveedorGuardia, null, h(PantallaInventario, { sub: 'registro' }))));
    const t = await screen.findByRole('table', { name: 'Movimientos de inventario' });
    expect(within(t).getByRole('columnheader', { name: /SKU/ })).toBeTruthy();
    expect(within(t).getByRole('columnheader', { name: /Series/ })).toBeTruthy();
  });
});

describe('4.3.5 serie oculta', () => {
  it('con un conteo abierto, «no se encontró» dice que puede estar oculta', () => {
    expect(textoSerieOculta([{ ubicacionId: 'tienda' }])).toBe('No se encontró, o está oculta: el almacén Tienda tiene un conteo abierto y sus series disponibles no se muestran hasta cerrarlo.');
    expect(textoSerieOculta([])).toBeUndefined();
  });
  it('se ve en la pantalla al buscar una serie inexistente', async () => {
    const e = await conConteo('sup');
    render(e.envolver(h(ProveedorGuardia, null, h(PantallaInventario, { sub: 'series' }))));
    const u = userEvent.setup();
    await u.type(await screen.findByLabelText('Número de serie (completo, o sus primeros 4 caracteres o más)'), 'NOEXISTE-1');
    await u.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText(/No se encontró, o está oculta: el almacén Tienda tiene un conteo abierto/)).toBeTruthy();
    expect(screen.queryByText('No se encontró esa serie')).toBeNull();
  });
  it('la tabla del resultado de la búsqueda por serie sale en tarjetas en el celular', async () => {
    render(crearEntorno('sup').envolver(h(ProveedorGuardia, null, h(PantallaInventario, { sub: 'series' }))));
    const u = userEvent.setup();
    await u.type(await screen.findByLabelText('Número de serie (completo, o sus primeros 4 caracteres o más)'), 'TV55-001');
    await u.click(screen.getByRole('button', { name: 'Buscar' }));
    const t = await screen.findByRole('table', { name: 'Resultado de la búsqueda por serie' });
    expect(t.classList.contains('tabla-tarjetas')).toBe(true);
  });
});

describe('9.1.1 aviso de conteo (D6)', () => {
  it('el administrador en Inventario ve el aviso aunque el servidor no le oculte nada', async () => {
    const e = await conConteo('adm');
    render(e.envolver(h(ProveedorGuardia, null, h(PantallaInventario, { sub: 'productos' }))));
    expect(await screen.findByText(/Hay un conteo abierto en Tienda desde/)).toBeTruthy();
  });
  it('Mermas muestra el aviso, también al administrador', async () => {
    const e = await conConteo('adm');
    render(e.envolver(h(ProveedorGuardia, null, h(PantallaMermas, {}))));
    expect(await screen.findByText(/Hay un conteo abierto en Tienda desde/)).toBeTruthy();
  });
  it('sin conteo abierto no hay aviso', async () => {
    const e = crearEntorno('adm');
    render(e.envolver(h(ProveedorGuardia, null, h(PantallaMermas, {}))));
    await screen.findByRole('heading', { name: 'Mermas' });
    expect(screen.queryByText(/Hay un conteo abierto/)).toBeNull();
  });
  it('al abrir el conteo, el mensaje avisa que cajeros y supervisores no ven existencias', async () => {
    const e = crearEntorno('adm');
    render(e.envolver(h(ProveedorGuardia, null, h(PantallaInventario, { sub: 'conteo' }))));
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Abrir conteo' }));
    expect(await screen.findByText('Conteo abierto en Tienda. Mientras dure, cajeros y supervisores no ven sus existencias.')).toBeTruthy();
  });
});

describe('9.2.1 estado de guardado del conteo', () => {
  it('«Guardado» se dice con ícono y texto, no solo con color', async () => {
    const e = crearEntorno('adm');
    await e.api.llamar('abrirConteo', { operacionId: uuid(), conteoId: 'c1', ubicacionId: 'tienda' });
    render(e.envolver(h(ProveedorGuardia, null, h(PantallaInventario, { sub: 'conteo' }))));
    const u = userEvent.setup();
    const campo = (await screen.findAllByLabelText(/^Cantidad de /))[0] as HTMLInputElement;
    await u.type(campo, '3');
    await waitFor(() => expect(document.querySelector('[data-prueba="estado-guardado"]')?.textContent).toMatch(/Sin guardar/));
    await u.tab();
    await waitFor(() => expect(document.querySelector('[data-prueba="estado-guardado"]')?.textContent).toMatch(/✓ Guardado/));
  });
});

describe('9.4 mermas: existencia actual y Ver movimientos', () => {
  it('la existencia oculta por un conteo dice «Oculta (conteo abierto)»', () => {
    const p = { existencias: { tienda: null, 'deposito-1': 4, 'deposito-2': 0 } } as never;
    expect(textoExistenciaActual(p, 'tienda')).toBe('Oculta (conteo abierto)');
    expect(textoExistenciaActual(p, 'deposito-1')).toBe('4');
    expect(textoExistenciaActual(p, 'deposito-2')).toBe('0');
    expect(textoExistenciaActual(undefined, 'tienda')).toBe('—');
  });
  it('un supervisor con la tienda en conteo ve «Oculta» y no una cifra', async () => {
    const e = crearEntorno('sup');
    await e.api.llamar('solicitarMerma', { operacionId: 'op-m', productoId: 'cable-hdmi', ubicacionId: 'tienda', cantidad: 1, motivo: 'Roto' });
    await e.api.llamar('abrirConteo', { operacionId: uuid(), conteoId: 'conteo-t', ubicacionId: 'tienda' });
    render(e.envolver(h(ProveedorGuardia, null, h(PantallaMermas, {}))));
    const t = await screen.findByRole('table', { name: 'Mermas' });
    expect(within(t).getByText('Oculta (conteo abierto)')).toBeTruthy();
  });
  it('«Ver movimientos» lleva al registro filtrado por el producto', async () => {
    const e = crearEntorno('sup');
    await e.api.llamar('solicitarMerma', { operacionId: 'op-m2', productoId: 'cable-hdmi', ubicacionId: 'tienda', cantidad: 1, motivo: 'Roto' });
    render(e.envolver(h(ProveedorGuardia, null, h(PantallaMermas, {}))));
    const enlace = await screen.findByRole('link', { name: /Ver movimientos de/ });
    expect(enlace.getAttribute('href')).toBe(enlaceMovimientos('cable-hdmi'));
    expect(separarSub('registro?producto=cable-hdmi')).toEqual({ pestana: 'registro', producto: 'cable-hdmi' });
    expect(separarSub('registro')).toEqual({ pestana: 'registro', producto: '' });
  });
});

describe('4.1.1 ayuda de la importación', () => {
  it('explica conSerie y garantiaMeses sin cambiar los encabezados', () => {
    const doc = Object.fromEntries(columnasArchivo([]).map((c) => [c.nombre, c.texto]));
    expect(doc['conSerie']).toMatch(/número de serie/);
    expect(doc['garantiaMeses']).toMatch(/1 a 120/);
  });
});
