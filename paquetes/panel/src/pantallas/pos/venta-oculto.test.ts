// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearEntorno, uuid, type Entorno } from '../../ayuda-pruebas.js';
import type { Rol } from '../../api/tipos.js';
import { PantallaVenta } from './venta.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const campo = (re: RegExp): HTMLElement => screen.getByLabelText(re);

/** Abre un conteo de la tienda como `sup`, abre el turno y deja la caja en el rol pedido. */
const montar = async (rol: Rol, conConteo: boolean): Promise<Entorno> => {
  const e = crearEntorno('sup');
  if (conConteo) await e.api.llamar('abrirConteo', { operacionId: uuid(), conteoId: 'conteo-tienda', ubicacionId: 'tienda' });
  e.como(rol);
  await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 10000 } });
  render(e.envolver(h(PantallaVenta, { sub: 'terminal' })));
  await screen.findByRole('heading', { name: 'Productos' });
  return e;
};

async function cobrarEfectivo(u: ReturnType<typeof userEvent.setup>, monto: string): Promise<void> {
  await u.click(screen.getByRole('button', { name: 'Cobrar' }));
  await screen.findByRole('heading', { name: 'Cobro' });
  await u.type(campo(/Monto a aplicar/), monto);
  await u.type(campo(/Efectivo recibido/), '100000');
}

describe('caja con un conteo abierto', () => {
  it('caj: avisa del conteo, no muestra cantidades ni «agotado», y vende un producto sin serie', async () => {
    const e = await montar('caj', true);
    const u = userEvent.setup();
    expect(await screen.findByText(/Hay un conteo abierto en Tienda/)).toBeTruthy();
    expect(screen.getAllByRole('img', { name: 'Oculto mientras hay un conteo abierto' }).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/Tienda: \d/);
    expect(document.body.textContent).not.toMatch(/agotado/i);
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    await waitFor(() => expect(document.querySelector('[data-prueba="total"]')?.textContent).toBe('Bs 55,68'));
    expect(document.body.textContent).not.toMatch(/Tienda \(\d+\)/);
    await cobrarEfectivo(u, '55,68');
    await u.click(screen.getByRole('button', { name: 'Confirmar cobro' }));
    await screen.findByText('La venta se registró correctamente.');
    void e;
  });

  it('caj: producto con serie se vende escribiendo la serie, sin listar las demás', async () => {
    await montar('caj', true);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Agregar Televisor 55 pulgadas' }));
    expect(screen.queryByRole('checkbox')).toBeNull();
    await u.type(campo(/Serie de la unidad/), 'TV55-001{Enter}');
    await waitFor(() => expect(screen.getByText('Unidades: 1')).toBeTruthy());
    expect(document.activeElement).toBe(campo(/Serie de la unidad/));
    expect(document.body.textContent).not.toContain('TV55-002');
  });

  it('caj: una serie inválida muestra el error junto al campo', async () => {
    await montar('caj', true);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Agregar Televisor 55 pulgadas' }));
    await u.type(campo(/Serie de la unidad/), 'NO-EXISTE{Enter}');
    expect((await screen.findByText('Esa serie no existe.')).getAttribute('role')).toBe('alert');
    expect(campo(/Serie de la unidad/).getAttribute('aria-invalid')).toBe('true');
    await u.clear(campo(/Serie de la unidad/));
    await u.type(campo(/Serie de la unidad/), 'TV55-004{Enter}');
    expect((await screen.findByText('Esa serie es de otro almacén.')).getAttribute('role')).toBe('alert');
  });

  it('caj: si no alcanza el stock, el rechazo no dice la cantidad', async () => {
    await montar('caj', true);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Agregar Parlante portátil' }));
    const cant = campo(/Cantidad/);
    await u.clear(cant);
    await u.type(cant, '500');
    await cobrarEfectivo(u, '87000');
    await u.click(screen.getByRole('button', { name: 'Confirmar cobro' }));
    const msg = await screen.findByText(/No alcanza el stock/);
    expect(msg.textContent).not.toMatch(/hay \d/);
  });

  it('adm: ve las cantidades y la lista de series, sin aviso', async () => {
    await montar('adm', true);
    const u = userEvent.setup();
    expect(screen.queryByText(/Hay un conteo abierto/)).toBeNull();
    expect(document.body.textContent).toMatch(/Tienda: \d/);
    await u.click(await screen.findByRole('button', { name: 'Agregar Televisor 55 pulgadas' }));
    expect(await screen.findByRole('checkbox', { name: 'TV55-001' })).toBeTruthy();
  });

  it('sin conteo: todo como hoy', async () => {
    await montar('caj', false);
    const u = userEvent.setup();
    expect(screen.queryByText(/Hay un conteo abierto/)).toBeNull();
    expect(document.body.textContent).toMatch(/Tienda: \d/);
    await u.click(await screen.findByRole('button', { name: 'Agregar Televisor 55 pulgadas' }));
    expect(await screen.findByRole('checkbox', { name: 'TV55-001' })).toBeTruthy();
    expect(screen.queryByLabelText(/Serie de la unidad/)).toBeNull();
  });
});
