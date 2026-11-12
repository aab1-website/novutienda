// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, render, screen, waitFor, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorApi } from '../../api/errores.js';
import { crearEntorno, type Entorno } from '../../ayuda-pruebas.js';
import { ProveedorGuardia } from '../../ui/guardia.js';
import { PantallaMermas } from './mermas.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ver = (e: Entorno): void => void render(e.envolver(h(ProveedorGuardia, null, h(PantallaMermas, {}))));
/** El supervisor solicita una merma de 2 cables; después entra el administrador. */
async function conMermaPendiente(): Promise<Entorno> {
  const e = crearEntorno('sup');
  await e.api.llamar('solicitarMerma', { operacionId: 'op-merma-1', productoId: 'cable-hdmi', ubicacionId: 'tienda', cantidad: 2, motivo: 'Cable cortado' });
  e.como('adm');
  return e;
}
const llamadas = (e: Entorno, nombre: string): { entrada: Record<string, unknown> }[] => e.api.llamadas.filter((l) => l.nombre === nombre) as never;

describe('solicitar', () => {
  it('marca los errores junto a cada campo y no llama al servidor', async () => {
    const e = crearEntorno('sup');
    ver(e);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Solicitar merma' }));
    expect(await screen.findByText(/Elija un producto/)).toBeTruthy();
    expect(screen.getByText('Error: Escriba el motivo de la merma.')).toBeTruthy();
    expect(llamadas(e, 'solicitarMerma')).toHaveLength(0);
  });

  it('solicita con el nombre del producto en el aviso', async () => {
    const e = crearEntorno('sup');
    ver(e);
    const u = userEvent.setup();
    const producto = await screen.findByRole('combobox', { name: /^Producto/ });
    await u.click(producto);
    await u.type(producto, 'cable');
    await u.click(await screen.findByRole('option', { name: /Cable HDMI/ }));
    await u.type(screen.getByLabelText(/^Motivo/), 'Cable cortado');
    await u.click(screen.getByRole('button', { name: 'Solicitar merma' }));
    expect(await screen.findByText(/Merma de Cable HDMI 2 m solicitada/)).toBeTruthy();
  });
});

describe('resolver', () => {
  it('muestra las pendientes primero y la propia no se resuelve', async () => {
    const e = crearEntorno('sup');
    await e.api.llamar('solicitarMerma', { operacionId: 'op-merma-1', productoId: 'cable-hdmi', ubicacionId: 'tienda', cantidad: 1, motivo: 'Roto' });
    ver(e);
    expect(await screen.findByText('La resuelve otra persona')).toBeTruthy();
    expect((screen.getByLabelText('Estado') as HTMLSelectElement).value).toBe('solicitada');
  });

  it('aprobar pide confirmar con «Hay N, quedarán M» y recién entonces mueve el stock', async () => {
    const e = await conMermaPendiente();
    ver(e);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Aprobar la merma de Cable HDMI 2 m' }));
    const d = await screen.findByRole('dialog', { name: '¿Aprobar esta merma?' });
    expect(within(d).getByText('Hay 25, quedarán 23.')).toBeTruthy();
    expect(llamadas(e, 'resolverMerma')).toHaveLength(0);
    await u.click(within(d).getByRole('button', { name: 'Sí, aprobar' }));
    expect(await screen.findByText(/Merma de Cable HDMI 2 m aprobada/)).toBeTruthy();
    expect((await e.api.llamar('listarProductos', {})).find((p) => p.id === 'cable-hdmi')?.existencias.tienda).toBe(23);
  });

  it('rechazar exige motivo junto al campo y lo envía', async () => {
    const e = await conMermaPendiente();
    ver(e);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Rechazar la merma de Cable HDMI 2 m' }));
    const d = await screen.findByRole('dialog', { name: '¿Rechazar esta merma?' });
    await u.click(within(d).getByRole('button', { name: 'Sí, rechazar' }));
    expect(within(d).getByText('Error: Escriba por qué rechaza la merma.')).toBeTruthy();
    expect(llamadas(e, 'resolverMerma')).toHaveLength(0);
    await u.type(within(d).getByLabelText(/^Motivo del rechazo/), 'Está en buen estado');
    await u.click(within(d).getByRole('button', { name: 'Sí, rechazar' }));
    await waitFor(() => expect(llamadas(e, 'resolverMerma')).toHaveLength(1));
    expect(llamadas(e, 'resolverMerma')[0]?.entrada).toMatchObject({ decision: 'rechazada', motivo: 'Está en buen estado' });
    expect((await e.api.llamar('listarProductos', {})).find((p) => p.id === 'cable-hdmi')?.existencias.tienda).toBe(25);
  });

  it('si el servidor rechaza el motivo vacío, el error sale junto al campo', async () => {
    const e = await conMermaPendiente();
    ver(e);
    const u = userEvent.setup();
    const original = e.api.llamar.bind(e.api);
    vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, en: unknown) => (n === 'resolverMerma'
      ? Promise.reject(new ErrorApi('invalid-argument', 'Indique el motivo del rechazo.', { codigo: 'entrada-invalida' }))
      : original(n as never, en as never))) as never);
    await u.click(await screen.findByRole('button', { name: 'Rechazar la merma de Cable HDMI 2 m' }));
    const d = await screen.findByRole('dialog', { name: '¿Rechazar esta merma?' });
    await u.type(within(d).getByLabelText(/^Motivo del rechazo/), 'Algo');
    await u.click(within(d).getByRole('button', { name: 'Sí, rechazar' }));
    expect(await within(d).findByText('Error: Indique el motivo del rechazo.')).toBeTruthy();
    expect(within(d).queryByRole('alert')).toBeNull();
  });

  it('el filtro por estado pide al servidor y la rechazada muestra su motivo de resolución', async () => {
    const e = await conMermaPendiente();
    await e.api.llamar('resolverMerma', { operacionId: 'op-res-1', mermaId: (await e.api.llamar('listarMermas', {})).mermas[0]?.mermaId ?? '', decision: 'rechazada', motivo: 'Está en buen estado' });
    ver(e);
    const u = userEvent.setup();
    expect(await screen.findByText('No hay mermas pendientes')).toBeTruthy();
    await u.selectOptions(screen.getByLabelText('Estado'), 'rechazada');
    expect(await screen.findByText('Está en buen estado')).toBeTruthy();
    expect(llamadas(e, 'listarMermas').some((l) => l.entrada['estado'] === 'rechazada')).toBe(true);
  });

  it('muestra «Procesando» en la fila mientras el servidor resuelve', async () => {
    const e = await conMermaPendiente();
    const original = e.api.llamar.bind(e.api);
    let soltar: () => void = () => undefined;
    vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, en: unknown) =>
      n === 'resolverMerma' ? new Promise((ok) => { soltar = () => ok(original(n as never, en as never)); }) : original(n as never, en as never)) as never);
    ver(e);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Aprobar la merma de Cable HDMI 2 m' }));
    const d = await screen.findByRole('dialog');
    await u.click(within(d).getByRole('button', { name: 'Sí, aprobar' }));
    expect(await screen.findByText('Procesando…', { selector: 'td' })).toBeTruthy();
    soltar();
    await waitFor(() => expect(screen.queryByText('Procesando…', { selector: 'td' })).toBeNull());
  });

  it('avisa si la lista está cortada', async () => {
    const e = await conMermaPendiente();
    const original = e.api.llamar.bind(e.api);
    vi.spyOn(e.api, 'llamar').mockImplementation((async (n: string, en: unknown) => {
      if (n !== 'listarMermas') return original(n as never, en as never);
      const r = await original(n as never, en as never);
      return { ...(r as object), cortada: true };
    }) as never);
    ver(e);
    expect(await screen.findByText(/Se muestran las primeras 1 mermas; hay más/)).toBeTruthy();
  });
});
