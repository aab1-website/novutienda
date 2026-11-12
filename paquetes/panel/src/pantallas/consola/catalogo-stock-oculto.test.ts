// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { crearEntorno, uuid } from '../../ayuda-pruebas.js';
import { PantallaCatalogo } from './catalogo.js';

afterEach(cleanup);

const SUBS = ['tablero', 'apariencia', 'fichas', 'exportar', 'secciones'];

describe('catálogo: no muestra existencias ni disponibilidad', () => {
  it.each(['sup', 'adm'] as const)('%s con un conteo abierto: ninguna pestaña muestra cantidades, «agotado» ni «disponible»', async (rol) => {
    const e = crearEntorno('sup');
    await e.api.llamar('abrirConteo', { operacionId: uuid(), conteoId: 'conteo-tienda', ubicacionId: 'tienda' });
    e.como(rol);
    for (const sub of SUBS) {
      const { container, unmount } = render(e.envolver(h(PantallaCatalogo, { sub })));
      await new Promise((r) => setTimeout(r, 20));
      expect(container.textContent ?? '', sub).not.toMatch(/agotad|existencias|en stock|stock|unidades disponibles/i);
      unmount();
    }
    expect(screen.queryByText(/Oculto mientras hay un conteo abierto/)).toBeNull();
  });
});
