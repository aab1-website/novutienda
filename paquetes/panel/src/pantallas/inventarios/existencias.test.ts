// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, render, screen, waitFor, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { Rol } from '../../api/tipos.js';
import { crearEntorno, uuid, type Entorno } from '../../ayuda-pruebas.js';
import { AyudaInventario } from './ayuda-inventario.js';
import { ExistenciasPorAlmacen } from './existencias.js';

afterEach(cleanup);

// Audífonos inalámbricos tiene 5 unidades en Depósito 2 (el caso HUMO-003 del plan).
const ver = (e: Entorno): void => void render(e.envolver(h(ExistenciasPorAlmacen, {})));
const elegir = async (nombre: string): Promise<void> => void (await userEvent.setup().selectOptions(screen.getByLabelText('Almacén'), nombre));
async function conConteo(rol: Rol): Promise<Entorno> {
  const e = crearEntorno('sup');
  await e.api.llamar('abrirConteo', { operacionId: uuid(), conteoId: 'c-tienda', ubicacionId: 'tienda' });
  e.como(rol);
  return e;
}

describe('existencias por almacén', () => {
  it('adm ve 5 unidades de Audífonos en Depósito 2, con encabezado y sin los que están en 0', async () => {
    const e = crearEntorno('adm');
    ver(e);
    await screen.findByText(/^En Tienda:/);
    await elegir('Depósito 2');
    expect(await screen.findByText('En Depósito 2: 5 unidades de 1 producto')).toBeTruthy();
    const t = screen.getByRole('table', { name: 'Existencias en Depósito 2' });
    const fila = within(t).getByText('Audífonos inalámbricos').closest('tr');
    expect(fila?.textContent).toContain('5');
    expect(within(t).queryByText('Cable HDMI 2 m')).toBeNull();
  });

  it('la casilla agrega los que están en 0', async () => {
    const e = crearEntorno('adm');
    ver(e);
    await screen.findByText(/^En Tienda:/);
    await elegir('Depósito 2');
    await userEvent.setup().click(screen.getByLabelText('Mostrar también los que están en 0'));
    expect(await screen.findByText('En Depósito 2: 5 unidades de 5 productos')).toBeTruthy();
  });

  it.each(['caj', 'sup'] as const)('%s con un conteo en Tienda: sin cifras, sin tabla y con el aviso; Depósito 1 sí se ve', async (rol) => {
    const e = await conConteo(rol);
    ver(e);
    expect(await screen.findByText('Las existencias de Tienda no se muestran mientras dure el conteo.')).toBeTruthy();
    expect(screen.getByText(/Hay un conteo abierto en Tienda/)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText(/^En Tienda:/)).toBeNull();
    expect(screen.queryByText(/unidades/)).toBeNull();
    await elegir('Depósito 1');
    expect(await screen.findByText('En Depósito 1: 12 unidades de 2 productos')).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Existencias en Depósito 1' })).toBeTruthy();
    expect(screen.queryByText(/Hay un conteo abierto/)).toBeNull();
  });

  it('adm con un conteo ve la tienda, sin el aviso de ocultamiento', async () => {
    const e = await conConteo('adm');
    ver(e);
    expect(await screen.findByText(/^En Tienda:/)).toBeTruthy();
    expect(screen.queryByText(/no se muestran/)).toBeNull();
  });

  it('con el conteo cerrado, caj vuelve a ver la tienda', async () => {
    const e = await conConteo('caj');
    e.como('sup');
    await e.api.llamar('cerrarConteo', { operacionId: uuid(), conteoId: 'c-tienda', sinContar: 'cero' });
    e.como('caj');
    ver(e);
    expect(await screen.findByText(/^En Tienda:/)).toBeTruthy();
  });
});

describe('ayuda «Cómo funciona el inventario»', () => {
  it('abre un panel lateral con los temas y al cerrar devuelve el foco al botón', async () => {
    const e = crearEntorno('adm');
    render(e.envolver(h(AyudaInventario, {})));
    const u = userEvent.setup();
    const boton = screen.getByRole('button', { name: 'Cómo funciona el inventario' });
    await u.click(boton);
    const d = await screen.findByRole('dialog', { name: 'Cómo funciona el inventario' });
    for (const tema of ['Almacenes', 'Ingreso', 'Traspaso', 'Ajuste', 'Conteo ciego', 'Series', 'Dónde se ve cada cosa']) expect(within(d).getByText(tema)).toBeTruthy();
    await u.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(boton));
  });
});
