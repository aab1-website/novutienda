// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearEntorno } from '../../ayuda-pruebas.js';
import { PantallaCatalogo } from './catalogo.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('catálogo: exportar', () => {
  it('exporta el CSV, avisa el éxito y enlaza a la importación de Inventario', async () => {
    const e = crearEntorno('adm');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }));
    render(e.envolver(h(PantallaCatalogo, { sub: 'exportar' })));
    const u = userEvent.setup();
    expect(screen.getByText(/Los productos se crean e importan en Inventario/)).toBeTruthy();
    expect(screen.getByText(/precios en dólares, con decimales, y puede reimportarse en Inventario/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ir a la importación de Inventario' }).getAttribute('href')).toBe('#/inventario/csv');
    await u.click(screen.getByRole('button', { name: 'Exportar productos (CSV)' }));
    expect(await screen.findByText(/productos-sitio\.csv generado/)).toBeTruthy();
    await waitFor(() => expect(e.api.llamadas.some((l) => l.nombre === 'exportarProductosCsvSitio')).toBe(true));
  });
  it('no tiene controles de importación', async () => {
    const e = crearEntorno('adm');
    render(e.envolver(h(PantallaCatalogo, { sub: 'exportar' })));
    expect(screen.queryByLabelText('Archivo a importar')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Importar' })).toBeNull();
    expect(screen.queryByText(/Simulación/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Exportar' })).toBeTruthy();
  });
});

describe('catálogo: mercados declarados', () => {
  it('el tenant de referencia ve los nombres de sus mercados', async () => {
    const e = crearEntorno('adm');
    render(e.envolver(h(PantallaCatalogo, { sub: 'tablero' })));
    expect(await screen.findByText(/Bolivia:/)).toBeTruthy();
    expect(screen.getByText(/Argentina:/)).toBeTruthy();
  });
  it('un id de mercado no declarado se muestra tal cual', async () => {
    const e = crearEntorno('adm', undefined, { comercial: { mercados: [{ id: 'BO', nombre: 'Bolivia', monedaVenta: 'BOB', monedaBase: 'USD', tieneTipoCambio: true }], monedasCaja: ['BOB'] } });
    render(e.envolver(h(PantallaCatalogo, { sub: 'tablero' })));
    expect(await screen.findByText(/Bolivia:/)).toBeTruthy();
    expect(screen.getByText(/AR:/)).toBeTruthy();
  });
  it('mientras la configuración comercial carga, no muestra mercados', async () => {
    const e = crearEntorno('adm');
    vi.spyOn(e.api, 'llamar').mockImplementation((() => new Promise(() => undefined)) as never);
    render(e.envolver(h(PantallaCatalogo, { sub: 'tablero' })));
    expect(screen.queryByText(/Bolivia:|BO:/)).toBeNull();
    expect(document.body.textContent ?? '').toMatch(/Cargando/);
  });
  it('si la configuración comercial falla, muestra el error y no ids crudos', async () => {
    const e = crearEntorno('adm');
    const llamar = e.api.llamar.bind(e.api) as (n: string, x: unknown) => Promise<unknown>;
    vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, x: unknown) => (n === 'configuracionComercial' ? Promise.reject(new Error('falla comercial')) : llamar(n, x))) as never);
    render(e.envolver(h(PantallaCatalogo, { sub: 'tablero' })));
    await waitFor(() => expect(document.querySelector('[role="alert"], .alerta')).not.toBeNull());
    expect(screen.queryByText(/BO:|AR:/)).toBeNull();
  });
});

describe('catálogo: tablero', () => {
  it('la fecha de publicación se llama «Última publicación del sitio»', async () => {
    const e = crearEntorno('adm');
    render(e.envolver(h(PantallaCatalogo, { sub: 'tablero' })));
    expect(await screen.findByText('Última publicación del sitio')).toBeTruthy();
    expect(screen.getByText('Todavía no se publicó')).toBeTruthy();
    expect(screen.queryByText('Publicado')).toBeNull();
  });
});
