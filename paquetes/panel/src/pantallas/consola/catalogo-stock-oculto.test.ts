// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { crearEntorno, uuid } from '../../ayuda-pruebas.js';
import { PantallaCatalogo } from './catalogo.js';

afterEach(cleanup);

/** Pestaña → encabezado que confirma que cargó. */
const SUBS: Record<string, RegExp> = {
  tablero: /^Sitio$/,
  apariencia: /^Plantilla de color$/,
  fichas: /^Páginas de producto en el sitio$/,
  exportar: /^Exportar productos$/,
  secciones: /^Secciones del menú/,
};

describe('catálogo: no muestra existencias ni disponibilidad', () => {
  it.each(['sup', 'adm'] as const)('%s con un conteo abierto: ninguna pestaña muestra cantidades, «agotado» ni «disponible»', async (rol) => {
    const e = crearEntorno('sup');
    await e.api.llamar('abrirConteo', { operacionId: uuid(), conteoId: 'conteo-tienda', ubicacionId: 'tienda' });
    e.como(rol);
    for (const [sub, encabezado] of Object.entries(SUBS)) {
      const { container, unmount } = render(e.envolver(h(PantallaCatalogo, { sub })));
      // Quien no es adm solo ve «tablero» y «fichas»; las demás pestañas caen en el tablero.
      const cargada = rol === 'adm' || sub === 'fichas' ? encabezado : SUBS['tablero']!;
      await screen.findByText(cargada, undefined, { timeout: 3000 });
      expect(container.textContent ?? '', sub).not.toMatch(/agotad|existencias|en stock|stock|unidades disponibles/i);
      unmount();
    }
    expect(screen.queryByText(/Oculto mientras hay un conteo abierto/)).toBeNull();
  });
});
