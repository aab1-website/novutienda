// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, render, screen, waitFor, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorApi } from '../../api/errores.js';
import { crearEntorno, type Entorno } from '../../ayuda-pruebas.js';
import { ProveedorGuardia } from '../../ui/guardia.js';
import { PantallaInventario } from './inventario.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const CABLE = 'Cable HDMI 2 m';
const PARLANTE = 'Parlante portátil';
const ver = (e: Entorno): void => void render(e.envolver(h(ProveedorGuardia, null, h(PantallaInventario, { sub: 'productos' }))));
const abrir = async (u: ReturnType<typeof userEvent.setup>, nombre: string): Promise<HTMLElement> => {
  await u.click(await screen.findByRole('button', { name: `Datos del producto de ${nombre}` }));
  return screen.findByRole('dialog', { name: `Datos del producto: ${nombre}` });
};
const cambiarNombre = async (u: ReturnType<typeof userEvent.setup>, d: HTMLElement, nombre: string): Promise<void> => {
  await u.clear(within(d).getByLabelText(/^Nombre/));
  await u.type(within(d).getByLabelText(/^Nombre/), nombre);
};

/** Deja `actualizarProducto` pendiente hasta que la prueba lo resuelva o lo rechace. */
function retener(e: Entorno): { resolver: () => void; rechazar: (x: Error) => void } {
  const original = e.api.llamar.bind(e.api);
  let soltar: () => void = () => undefined;
  let fallar: (x: Error) => void = () => undefined;
  vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, en: unknown) => {
    if (n !== 'actualizarProducto') return original(n as never, en as never);
    return new Promise((ok, mal) => {
      soltar = () => void original(n as never, en as never).then(ok, mal);
      fallar = mal;
    });
  }) as never);
  return { resolver: () => soltar(), rechazar: (x) => fallar(x) };
}

describe('guardado del producto con la llamada en vuelo', () => {
  it('mientras guarda no se puede cerrar el panel: Cancelar queda apagado y Escape no lo cierra', async () => {
    const e = crearEntorno('adm');
    const r = retener(e);
    ver(e);
    const u = userEvent.setup();
    const d = await abrir(u, CABLE);
    await cambiarNombre(u, d, 'Cable HDMI 3 m');
    await u.click(within(d).getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect((within(d).getByRole('button', { name: 'Cancelar' }) as HTMLButtonElement).disabled).toBe(true));
    await u.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: /^Datos del producto/ })).not.toBeNull();
    r.resolver();
    expect(await screen.findByText('Cambios guardados: Cable HDMI 3 m.')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('un rechazo del servidor con el panel abierto se muestra y el panel no se cierra ni da por guardado', async () => {
    const e = crearEntorno('adm');
    const r = retener(e);
    ver(e);
    const u = userEvent.setup();
    const d = await abrir(u, CABLE);
    await cambiarNombre(u, d, 'Cable HDMI 3 m');
    await u.click(within(d).getByRole('button', { name: 'Guardar cambios' }));
    r.rechazar(new ErrorApi('aborted', 'Demasiadas operaciones a la vez. Intente de nuevo.'));
    expect((await within(d).findAllByText(/Intente de nuevo/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Cambios guardados/)).toBeNull();
    expect(screen.queryByRole('dialog', { name: `Datos del producto: ${CABLE}` })).not.toBeNull();
  });

  it('si la pantalla se desmonta con la llamada en vuelo, el error igual se avisa (no se pierde en silencio)', async () => {
    const e = crearEntorno('adm');
    const r = retener(e);
    const pantalla = render(e.envolver(h(ProveedorGuardia, null, h(PantallaInventario, { sub: 'productos' }))));
    const u = userEvent.setup();
    const d = await abrir(u, CABLE);
    await cambiarNombre(u, d, 'Cable HDMI 3 m');
    await u.click(within(d).getByRole('button', { name: 'Guardar cambios' }));
    // La persona cambia de pantalla: el panel desaparece, pero la llamada sigue.
    pantalla.rerender(e.envolver(h(ProveedorGuardia, null, h('p', null, 'otra pantalla'))));
    r.rechazar(new ErrorApi('aborted', 'Demasiadas operaciones a la vez. Intente de nuevo.'));
    expect(await screen.findByText(/Intente de nuevo/)).toBeTruthy();
  });

  it('al guardar un producto y abrir otro enseguida, el cierre del primero no cierra el panel del segundo', async () => {
    const e = crearEntorno('adm');
    const r = retener(e);
    ver(e);
    const u = userEvent.setup();
    const d = await abrir(u, CABLE);
    await cambiarNombre(u, d, 'Cable HDMI 3 m');
    await u.click(within(d).getByRole('button', { name: 'Guardar cambios' }));
    r.resolver();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await abrir(u, PARLANTE);
    await new Promise((x) => setTimeout(x, 50));
    expect(screen.queryByRole('dialog', { name: `Datos del producto: ${PARLANTE}` })).not.toBeNull();
  });

  it('no se ofrece editar un producto recién guardado hasta que la lista nueva llegue', async () => {
    const e = crearEntorno('adm');
    const original = e.api.llamar.bind(e.api);
    let retenerLista = false;
    vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, en: unknown) => {
      if (n === 'listarProductos' && retenerLista) return new Promise((ok, mal) => setTimeout(() => original(n as never, en as never).then(ok, mal), 400));
      return original(n as never, en as never);
    }) as never);
    ver(e);
    const u = userEvent.setup();
    const d = await abrir(u, CABLE);
    await cambiarNombre(u, d, 'Cable HDMI 3 m');
    retenerLista = true;
    await u.click(within(d).getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // La lista aún muestra el nombre viejo: no se ofrece editar sobre datos viejos hasta que llegue la lista nueva.
    const boton = (await screen.findByRole('button', { name: `Datos del producto de ${CABLE}` })) as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
    await waitFor(() => expect(screen.queryByRole('button', { name: `Datos del producto de ${CABLE}` })).toBeNull());
    const d2 = await abrir(u, 'Cable HDMI 3 m');
    expect((within(d2).getByLabelText(/^Nombre/) as HTMLInputElement).value).toBe('Cable HDMI 3 m');
  });
});
