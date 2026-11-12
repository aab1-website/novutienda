// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, render, screen, waitFor, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MovimientoVista } from '../../api/tipos.js';
import { crearEntorno, type Entorno } from '../../ayuda-pruebas.js';
import { Registro } from './registro.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mov = (i: number): MovimientoVista => ({ id: `m${String(i)}`, operacionId: 'o', series: [], tipo: 'ingreso', productoId: 'cable-hdmi', ubicacionId: i % 2 === 0 ? 'tienda' : 'deposito-1', delta: i + 1, saldoUbicacion: i + 1, por: 'u-adm', rol: 'adm', fecha: `2026-11-04T10:${String(i % 60).padStart(2, '0')}:00Z` });
const ver = (e: Entorno): void => void render(e.envolver(h(Registro, {})));
/** El servidor dice que la lista está cortada. */
const cortada = (e: Entorno, n: number): void => {
  const original = e.api.llamar.bind(e.api);
  vi.spyOn(e.api, 'llamar').mockImplementation(((nombre: string, entrada: unknown) =>
    nombre === 'listarMovimientos' ? Promise.resolve({ movimientos: Array.from({ length: n }, (_, i) => mov(i)), cortada: true }) : original(nombre as never, entrada as never)) as never);
};

describe('registro de acciones', () => {
  it('lista en una tabla con búsqueda, filtro por almacén y páginas', async () => {
    const e = crearEntorno('adm');
    cortada(e, 60);
    ver(e);
    const u = userEvent.setup();
    const t = await screen.findByRole('table', { name: 'Movimientos de inventario' });
    expect(within(t).getAllByRole('row')).toHaveLength(26);
    expect(screen.getByRole('navigation', { name: /Páginas/ })).toBeTruthy();
    await u.selectOptions(screen.getByLabelText('Almacén'), 'deposito-1');
    expect(within(screen.getByRole('table', { name: 'Movimientos de inventario' })).getAllByText('Depósito 1').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Buscar por producto, usuario o motivo')).toBeTruthy();
  });

  it('avisa que la lista está cortada con el número', async () => {
    const e = crearEntorno('adm');
    cortada(e, 60);
    ver(e);
    expect((await screen.findByText(/Se muestran los primeros 60 movimientos; hay más/))).toBeTruthy();
  });

  it('sin corte no hay aviso', async () => {
    const e = crearEntorno('adm');
    await e.api.llamar('ingresar', { operacionId: 'op-1', ubicacionId: 'tienda', lineas: [{ productoId: 'cable-hdmi', cantidad: 2 }] });
    ver(e);
    await screen.findByRole('table', { name: 'Movimientos de inventario' });
    expect(screen.queryByText(/Se muestran los primeros/)).toBeNull();
  });

  it('el CSV exportado de una lista cortada lo dice en el nombre y en una fila', async () => {
    const e = crearEntorno('adm');
    cortada(e, 3);
    let blob: Blob | undefined;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => { blob = b as Blob; return 'blob:x'; });
    vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
    let nombre = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { nombre = this.download; });
    ver(e);
    const u = userEvent.setup();
    await screen.findByRole('table', { name: 'Movimientos de inventario' });
    await u.click(screen.getByRole('button', { name: 'Exportar CSV' }));
    expect(nombre).toBe('movimientos-inventario-cortado.csv');
    await waitFor(() => expect(blob).toBeDefined());
    const texto = await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsText(blob as Blob); });
    expect(texto).toContain('AVISO: lista cortada. Solo trae los primeros 3 movimientos');
    expect(await screen.findByText(/El CSV está cortado/)).toBeTruthy();
  });

  it('exportar queda explicado cuando no hay movimientos', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    await u.selectOptions(await screen.findByLabelText('Tipo'), 'venta');
    await u.click(screen.getByRole('button', { name: 'Filtrar' }));
    expect(await screen.findByText('No hay movimientos con esos filtros')).toBeTruthy();
    expect(screen.getByText(/No hay movimientos que exportar/)).toBeTruthy();
  });
});
