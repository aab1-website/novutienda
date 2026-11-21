// @vitest-environment jsdom
import { h, type JSX } from 'preact';
import { act, cleanup, render, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCarga } from './hooks.js';

let ahora = 1_000_000;
beforeEach(() => {
  ahora = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => ahora);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useCarga con alVolver', () => {
  function Caso(p: { fn: () => Promise<number>; alVolver: boolean }): JSX.Element {
    const c = useCarga(p.fn, [], undefined, { alVolver: p.alVolver });
    return h('p', { 'data-prueba': 'n' }, String(c.datos ?? '-'));
  }

  it('recarga con focus y visibilitychange', async () => {
    const fn = vi.fn(() => Promise.resolve(1));
    render(h(Caso, { fn, alVolver: true }));
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    ahora += 1000;
    await act(() => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
    ahora += 1000;
    await act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(3));
  });

  it('sin la opción no recarga, y al desmontar se quitan los oyentes', async () => {
    const fn = vi.fn(() => Promise.resolve(1));
    const sin = render(h(Caso, { fn, alVolver: false }));
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    ahora += 1000;
    await act(() => { window.dispatchEvent(new Event('focus')); });
    expect(fn).toHaveBeenCalledTimes(1);
    sin.unmount();
    const con = vi.fn(() => Promise.resolve(1));
    const r = render(h(Caso, { fn: con, alVolver: true }));
    await waitFor(() => expect(con).toHaveBeenCalledTimes(1));
    r.unmount();
    window.dispatchEvent(new Event('focus'));
    expect(con).toHaveBeenCalledTimes(1);
  });

  it('visibilitychange y focus juntos recargan una sola vez', async () => {
    const fn = vi.fn(() => Promise.resolve(1));
    render(h(Caso, { fn, alVolver: true }));
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    ahora += 1000;
    await act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('la respuesta de una carga vieja no pisa a la más nueva', async () => {
    const esperas: ((n: number) => void)[] = [];
    const fn = vi.fn(() => new Promise<number>((r) => { esperas.push(r); }));
    function Periodico(): JSX.Element {
      const c = useCarga(fn, [], 20);
      return h('p', null, String(c.datos ?? '-'));
    }
    const { container } = render(h(Periodico, null));
    await waitFor(() => expect(esperas.length).toBeGreaterThanOrEqual(2));
    esperas[esperas.length - 1]?.(20);
    await waitFor(() => expect(container.textContent).toBe('20'));
    esperas[0]?.(10);
    await new Promise((r) => setTimeout(r, 10));
    expect(container.textContent).toBe('20');
  });
});
