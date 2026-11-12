// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, render, screen, waitFor, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorApi } from '../../api/errores.js';
import { crearEntorno, type Entorno } from '../../ayuda-pruebas.js';
import { ProveedorGuardia } from '../../ui/guardia.js';
import { Conteo } from './conteo.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ver = (e: Entorno): void => void render(e.envolver(h(ProveedorGuardia, null, h(Conteo, {}))));
const abrir = async (e: Entorno): Promise<ReturnType<typeof userEvent.setup>> => {
  ver(e);
  const u = userEvent.setup();
  await u.click(await screen.findByRole('button', { name: 'Abrir conteo' }));
  await screen.findByText(/Conteo abierto en/);
  return u;
};
const llamadas = (e: Entorno, nombre: string): { entrada: Record<string, unknown> }[] => e.api.llamadas.filter((l) => l.nombre === nombre) as never;

describe('conteo ciego', () => {
  it('no muestra existencias del sistema mientras se cuenta y muestra el avance', async () => {
    const e = crearEntorno('sup');
    await abrir(e);
    expect(screen.queryByRole('columnheader', { name: /Sistema|Existencia|Total/ })).toBeNull();
    const tabla = screen.getByRole('table', { name: 'Productos a contar' });
    // Las existencias demo (25 de cable, 5 del televisor) no aparecen en ninguna celda.
    expect(within(tabla).queryByText('25')).toBeNull();
    expect(screen.getByText(/Avance: 0 de \d+/)).toBeTruthy();
  });

  it('guarda al salir del campo si cambió, marca «Guardado» y sube el avance', async () => {
    const e = crearEntorno('sup');
    const u = await abrir(e);
    const campo = screen.getByLabelText('Cantidad de Cable HDMI 2 m');
    await u.type(campo, '20');
    expect(llamadas(e, 'registrarLineaConteo')).toHaveLength(0);
    await u.tab();
    await waitFor(() => expect(llamadas(e, 'registrarLineaConteo')).toHaveLength(1));
    expect(llamadas(e, 'registrarLineaConteo')[0]?.entrada).toMatchObject({ productoId: 'cable-hdmi', contado: 20 });
    await waitFor(() => expect(screen.getByText(/Avance: 1 de \d+/)).toBeTruthy());
    // Salir otra vez sin cambiar no vuelve a guardar.
    await u.click(campo);
    await u.tab();
    expect(llamadas(e, 'registrarLineaConteo')).toHaveLength(1);
    expect(within(campo.closest('td') as HTMLElement).getByText('Guardado')).toBeTruthy();
  });

  it('un valor inválido marca el error junto al campo y no llama al servidor', async () => {
    const e = crearEntorno('sup');
    const u = await abrir(e);
    await u.type(screen.getByLabelText('Cantidad de Cable HDMI 2 m'), '2,5');
    await u.tab();
    expect(await screen.findByText(/Escriba un número entero de 0 o más/)).toBeTruthy();
    expect(llamadas(e, 'registrarLineaConteo')).toHaveLength(0);
  });

  it('si el guardado falla dice qué producto y reintenta con el mismo identificador', async () => {
    const e = crearEntorno('sup');
    const u = await abrir(e);
    const original = e.api.llamar.bind(e.api);
    const ids: unknown[] = [];
    let falla = true;
    vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, en: { operacionId?: unknown }) => {
      if (n === 'registrarLineaConteo') {
        ids.push(en.operacionId);
        if (falla) {
          falla = false;
          return Promise.reject(new ErrorApi('unavailable', 'sin red'));
        }
      }
      return original(n as never, en as never);
    }) as never);
    await u.type(screen.getByLabelText('Cantidad de Cable HDMI 2 m'), '20');
    await u.tab();
    expect((await screen.findByText(/No se pudo guardar Cable HDMI 2 m/))).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Reintentar guardar Cable HDMI 2 m' }));
    await waitFor(() => expect(ids).toHaveLength(2));
    expect(ids[1]).toBe(ids[0]);
    await waitFor(() => expect(screen.getByText(/Avance: 1 de/)).toBeTruthy());
  });

  it('busca un producto entre los que hay que contar', async () => {
    const e = crearEntorno('sup');
    const u = await abrir(e);
    await u.type(screen.getByLabelText('Buscar producto a contar'), 'televisor');
    expect(screen.queryByLabelText('Cantidad de Cable HDMI 2 m')).toBeNull();
    expect(screen.getByLabelText(/Series de Televisor 55 pulgadas/)).toBeTruthy();
  });

  it('no deja cerrar con cantidades sin guardar y dice cuántas', async () => {
    const e = crearEntorno('sup');
    const u = await abrir(e);
    await u.type(screen.getByLabelText('Cantidad de Cable HDMI 2 m'), '20');
    expect(screen.getByText(/Hay 1 cantidad sin guardar/)).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Cerrar y firmar el conteo' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('al cerrar confirma con «faltan N; se contarán en 0 y generarán mermas» y firma', async () => {
    const e = crearEntorno('sup');
    const u = await abrir(e);
    await u.type(screen.getByLabelText('Cantidad de Cable HDMI 2 m'), '20');
    await u.tab();
    await waitFor(() => expect(screen.getByText(/Avance: 1 de/)).toBeTruthy());
    await u.click(screen.getByRole('button', { name: 'Cerrar y firmar el conteo' }));
    const d = await screen.findByRole('dialog', { name: '¿Cerrar y firmar el conteo?' });
    expect(d.textContent).toMatch(/Faltan \d+ productos?; se contarán en 0 y generarán mermas? por resolver/);
    expect(d.textContent).toContain('Contó 1 de');
    await u.click(within(d).getByRole('button', { name: 'Sí, cerrar y firmar' }));
    expect(await screen.findByText(/Conteo cerrado y firmado/)).toBeTruthy();
    const tabla = await screen.findByRole('table', { name: 'Resultado del conteo' });
    expect(tabla.textContent).toContain('-5');
  });
});
