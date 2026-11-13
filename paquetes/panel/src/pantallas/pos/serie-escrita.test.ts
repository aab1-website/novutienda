// @vitest-environment jsdom
import { h } from 'preact';
import { useState } from 'preact/hooks';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { crearEntorno } from '../../ayuda-pruebas.js';
import type { UnidadSerie } from '../../api/tipos.js';
import { SerieEscrita, motivoSerieNoVendible } from './serie-escrita.js';

afterEach(cleanup);

const unidad = (o: Partial<UnidadSerie> = {}): UnidadSerie => ({ productoId: 'tv', serie: 'S1', estado: 'disponible', ubicacionId: 'tienda', ...o });

describe('motivoSerieNoVendible', () => {
  it.each([
    ['inexistente', undefined, [], 'Esa serie no existe.'],
    ['de otro producto', unidad({ productoId: 'otro' }), [], 'Esa serie es de otro producto.'],
    ['de otro almacén', unidad({ ubicacionId: 'deposito-1' }), [], 'Esa serie es de otro almacén.'],
    ['ya vendida', unidad({ estado: 'vendida' }), [], 'Esa serie ya fue vendida.'],
    ['en merma', unidad({ estado: 'merma' }), [], 'Esa serie no está disponible.'],
    ['repetida en la venta', unidad(), ['S1'], 'Esa serie ya está en la venta.'],
    ['buena', unidad(), ['S2'], null],
  ] as const)('%s', (_n, u, enVenta, esperado) => {
    expect(motivoSerieNoVendible(u, 'tv', 'tienda', enVenta)).toBe(esperado);
  });
});

function Envoltorio(): preact.JSX.Element {
  const [series, setSeries] = useState<string[]>([]);
  return h('div', null, h(SerieEscrita, { productoId: 'tv-55', almacenId: 'tienda', elegidas: series, alCambiar: setSeries }), h('output', { 'data-prueba': 'elegidas' }, series.join(',')));
}

const campo = (): HTMLInputElement => screen.getByLabelText(/Serie de la unidad/) as HTMLInputElement;
const leer = (valor: string): void => {
  fireEvent.input(campo(), { target: { value: valor } });
  fireEvent.keyDown(campo(), { key: 'Enter' });
};
const elegidas = (): string => document.querySelector('[data-prueba="elegidas"]')?.textContent ?? '';

describe('SerieEscrita', () => {
  it('dos lecturas seguidas quedan agregadas en orden y el campo conserva el foco', async () => {
    const e = crearEntorno('caj');
    render(e.envolver(h(Envoltorio as never, null)));
    campo().focus();
    leer('TV55-001');
    leer('TV55-002');
    await waitFor(() => expect(elegidas()).toBe('TV55-001,TV55-002'), { timeout: 3000 });
    expect(campo().value).toBe('');
    expect(document.activeElement).toBe(campo());
  });

  it('recorta espacios y saltos de línea del lector', async () => {
    const e = crearEntorno('caj');
    render(e.envolver(h(Envoltorio as never, null)));
    leer('  TV55-001 \r\n');
    await waitFor(() => expect(elegidas()).toBe('TV55-001'), { timeout: 3000 });
  });

  it('rechaza la serie repetida en la venta, la inexistente y la de otro almacén', async () => {
    const e = crearEntorno('caj');
    render(e.envolver(h(Envoltorio as never, null)));
    leer('TV55-001');
    await waitFor(() => expect(elegidas()).toBe('TV55-001'), { timeout: 3000 });
    leer('TV55-001');
    expect(await screen.findByText('Esa serie ya está en la venta.')).toBeTruthy();
    leer('NO-EXISTE');
    expect(await screen.findByText('Esa serie no existe.')).toBeTruthy();
    leer('TV55-004');
    expect(await screen.findByText('Esa serie es de otro almacén.')).toBeTruthy();
    expect(elegidas()).toBe('TV55-001');
  });

  it('no normaliza mayúsculas: el servidor compara la serie exacta', async () => {
    const e = crearEntorno('caj');
    render(e.envolver(h(Envoltorio as never, null)));
    leer('tv55-001');
    expect(await screen.findByText('Esa serie no existe.')).toBeTruthy();
    expect(elegidas()).toBe('');
  });
});
