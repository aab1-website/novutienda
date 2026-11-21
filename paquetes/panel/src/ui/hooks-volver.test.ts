// @vitest-environment jsdom
import { h, type JSX } from 'preact';
import { act, cleanup, render, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCarga } from './hooks.js';

afterEach(cleanup);

describe('useCarga con alVolver', () => {
  function Caso(p: { fn: () => Promise<number>; alVolver: boolean }): JSX.Element {
    const c = useCarga(p.fn, [], undefined, { alVolver: p.alVolver });
    return h('p', { 'data-prueba': 'n' }, String(c.datos ?? '-'));
  }

  it('recarga con focus y visibilitychange', async () => {
    const fn = vi.fn(() => Promise.resolve(1));
    render(h(Caso, { fn, alVolver: true }));
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    await act(() => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
    await act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(3));
  });

  it('sin la opción no recarga, y al desmontar se quitan los oyentes', async () => {
    const fn = vi.fn(() => Promise.resolve(1));
    const sin = render(h(Caso, { fn, alVolver: false }));
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
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
});
