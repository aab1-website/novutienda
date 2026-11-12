// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, render, screen, waitFor, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { crearEntorno, uuid, type Entorno } from '../../ayuda-pruebas.js';
import { PantallaInventario } from './inventario.js';

afterEach(cleanup);

const ver = (e: Entorno): void => void render(e.envolver(h(PantallaInventario, { sub: 'productos' })));
const tabla = async (): Promise<HTMLElement> => screen.findByRole('table', { name: 'Productos y existencias por almacén' });

describe('productos en tabla', () => {
  it('muestra existencias por almacén con nombres legibles, estado y las dos acciones por fila', async () => {
    const e = crearEntorno('sup');
    ver(e);
    const t = await tabla();
    for (const c of ['Producto', 'Tienda', 'Depósito 1', 'Depósito 2', 'Total', 'Estado']) expect(within(t).getByRole('columnheader', { name: new RegExp(`^${c}`) })).toBeTruthy();
    expect(within(t).getByRole('button', { name: 'Datos del producto de Televisor 55 pulgadas' })).toBeTruthy();
    expect(within(t).getByRole('link', { name: 'Fotos y página en el sitio de Televisor 55 pulgadas' }).getAttribute('href')).toBe('#/catalogo/fichas');
    expect(within(t).getAllByText('Bajo el mínimo').length).toBe(2);
  });

  it('busca por nombre, SKU, categoría o marca', async () => {
    const e = crearEntorno('sup');
    ver(e);
    const u = userEvent.setup();
    const t = await tabla();
    await u.type(screen.getByLabelText('Buscar por nombre, SKU, categoría o marca'), 'cabletec');
    expect(within(t).getByText('Cable HDMI 2 m')).toBeTruthy();
    expect(within(t).queryByText('Televisor 55 pulgadas')).toBeNull();
  });

  it('«2 productos bajo el mínimo · Ver» activa el filtro y «Ver todos» lo quita', async () => {
    const e = crearEntorno('sup');
    ver(e);
    const u = userEvent.setup();
    const t = await tabla();
    expect(screen.getByText(/2 productos bajo el mínimo/)).toBeTruthy();
    expect(screen.queryByText(/Alerta de mínimo/)).toBeNull();
    await u.click(screen.getByRole('button', { name: 'Ver' }));
    expect(within(t).queryByText('Cable HDMI 2 m')).toBeNull();
    expect(within(t).getByText('Parlante portátil')).toBeTruthy();
    expect(within(t).getByText('Celular A1 128 GB')).toBeTruthy();
    expect((screen.getByLabelText('Mostrar') as HTMLSelectElement).value).toBe('bajo');
    await u.click(screen.getByRole('button', { name: 'Ver todos' }));
    expect(within(t).getByText('Cable HDMI 2 m')).toBeTruthy();
  });

  it('el filtro «Inactivos» muestra solo los inactivos', async () => {
    const e = crearEntorno('adm');
    await e.api.llamar('actualizarProducto', { operacionId: uuid(), productoId: 'audifonos', cambios: { activo: false } });
    ver(e);
    const u = userEvent.setup();
    const t = await tabla();
    await u.selectOptions(screen.getByLabelText('Mostrar'), 'inactivo');
    expect(within(t).getByText('Audífonos inalámbricos')).toBeTruthy();
    expect(within(t).queryByText('Cable HDMI 2 m')).toBeNull();
    expect(within(t).getByText('Inactivo')).toBeTruthy();
  });

  it('ordena por una columna', async () => {
    const e = crearEntorno('sup');
    ver(e);
    const u = userEvent.setup();
    const t = await tabla();
    await u.click(within(t).getByRole('button', { name: /^Total/ }));
    const primera = within(t).getAllByRole('row')[1];
    expect(primera?.textContent).toContain('Parlante portátil');
  });

  it('con muchos productos pagina', async () => {
    const e = crearEntorno('adm');
    for (let i = 0; i < 22; i += 1) {
      await e.api.llamar('crearProducto', { operacionId: uuid(), producto: { id: `extra-${String(i)}`, nombre: `Extra ${String(i)}`, categoria: 'x', sku: `EX-${String(i)}`, precioUSD: { bo: 100, ar: 100 } } });
    }
    ver(e);
    const u = userEvent.setup();
    await tabla();
    expect(screen.getByRole('navigation', { name: 'Páginas de Productos y existencias por almacén' })).toBeTruthy();
    expect(screen.getByText('1–25 de 27')).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByText('26–27 de 27')).toBeTruthy();
  });

  it('«Nuevo producto» es solo del administrador y el panel devuelve el foco a la fila al cerrar', async () => {
    const sup = crearEntorno('sup');
    ver(sup);
    await tabla();
    expect(screen.queryByRole('button', { name: 'Nuevo producto' })).toBeNull();
    cleanup();
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    const t = await tabla();
    const fila = within(t).getByRole('button', { name: 'Datos del producto de Cable HDMI 2 m' });
    await u.click(fila);
    const d = await screen.findByRole('dialog', { name: 'Datos del producto: Cable HDMI 2 m' });
    await u.click(within(d).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(fila));
  });

  it('sin productos explica cómo crear el primero', async () => {
    const e = crearEntorno('adm');
    e.api.estado.productos.clear();
    ver(e);
    expect(await screen.findByText(/No hay productos\. Cree el primero/)).toBeTruthy();
  });
});
