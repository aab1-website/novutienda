// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import type { ResultadoCierre } from '../../api/tipos.js';
import { ResumenArqueo } from './venta-cierre.js';

afterEach(cleanup);

describe('ResumenArqueo', () => {
  it('sale en tarjetas en el celular', () => {
    const cierre = { turno: {}, arqueo: { BOB: { esperado: 1000, contado: 900, diferencia: -100 } } } as unknown as ResultadoCierre;
    render(h(ResumenArqueo, { cierre, orden: ['BOB'] }));
    const tabla = screen.getByRole('table', { name: 'Arqueo del turno cerrado' });
    expect(tabla.classList.contains('tabla-tarjetas')).toBe(true);
  });
});
