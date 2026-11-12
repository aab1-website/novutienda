// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { crearEntorno } from '../../ayuda-pruebas.js';
import { PantallaInventario } from './inventario.js';

afterEach(cleanup);

describe('inventario: acciones por producto', () => {
  it('ofrece «Datos del producto» y el enlace a fotos y página en el sitio con su nombre accesible', async () => {
    render(crearEntorno('adm').envolver(h(PantallaInventario, { sub: 'productos' })));
    expect(await screen.findByRole('button', { name: 'Datos del producto de Televisor 55 pulgadas' })).toBeTruthy();
    const enlace = screen.getByRole('link', { name: 'Fotos y página en el sitio de Televisor 55 pulgadas' });
    expect(enlace.getAttribute('href')).toBe('#/catalogo/fichas');
    expect(screen.queryByRole('button', { name: /^Ficha/ })).toBeNull();
  });
});
