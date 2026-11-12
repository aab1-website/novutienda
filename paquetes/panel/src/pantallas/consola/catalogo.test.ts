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
