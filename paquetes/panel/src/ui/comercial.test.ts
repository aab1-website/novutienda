// @vitest-environment jsdom
import { h, type JSX } from 'preact';
import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearEntorno, usuarioDe } from '../ayuda-pruebas.js';
import { CtxApp } from './contexto.js';
import { useConfiguracionComercial } from './comercial.js';

afterEach(cleanup);

function Sonda(): JSX.Element {
  const c = useConfiguracionComercial();
  return h('p', { 'data-prueba': 'estado' }, c.estado === 'lista' ? `lista:${c.comercial.monedaCosto ?? 'sin-costo'}:${c.comercial.monedasCaja.join(',')}` : c.estado);
}
const texto = (): string => document.querySelector('[data-prueba="estado"]')?.textContent ?? '';

describe('configuración comercial ligada a la sesión', () => {
  it('administrador y luego cajero en el mismo tenant: el cajero no recibe lo del administrador', async () => {
    const e = crearEntorno('adm');
    const llamar = e.api.llamar.bind(e.api) as (n: string, x: unknown) => Promise<unknown>;
    const espia = vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, x: unknown) =>
      n === 'configuracionComercial'
        ? Promise.resolve({ mercados: [], monedasCaja: ['BOB'], ...(e.usuario().rol === 'adm' ? { monedaCosto: 'USD' } : {}) })
        : llamar(n, x)) as never);
    const { rerender } = render(e.envolver(h(Sonda, {})));
    await waitFor(() => expect(texto()).toBe('lista:USD:BOB'));
    e.como('caj');
    rerender(e.envolver(h(Sonda, {})));
    await waitFor(() => expect(texto()).toBe('lista:sin-costo:BOB'));
    expect(espia.mock.calls.filter((c) => c[0] === 'configuracionComercial')).toHaveLength(2);
  });

  it('el mismo uid que cambia de rol (administrador a cajero): se vuelve a pedir y no conserva monedaCosto', async () => {
    const e = crearEntorno('adm');
    let rol: 'adm' | 'caj' = 'adm';
    const espia = vi.spyOn(e.api, 'llamar').mockImplementation(((n: string) =>
      n === 'configuracionComercial'
        ? Promise.resolve({ mercados: [], monedasCaja: ['BOB'], ...(rol === 'adm' ? { monedaCosto: 'USD' } : {}) })
        : Promise.resolve({})) as never);
    const con = (r: 'adm' | 'caj'): JSX.Element =>
      h(CtxApp.Provider, { value: { api: e.api, almacen: e.almacen, usuario: { ...usuarioDe('adm'), rol: r }, cerrarSesion: () => undefined, sesionVencida: () => undefined, renovarSesion: () => Promise.resolve(true), puedeVer: () => true } }, h(Sonda, {}));
    const { rerender } = render(con('adm'));
    await waitFor(() => expect(texto()).toBe('lista:USD:BOB'));
    rol = 'caj';
    rerender(con('caj'));
    await waitFor(() => expect(texto()).toBe('lista:sin-costo:BOB'));
    expect(espia.mock.calls.filter((c) => c[0] === 'configuracionComercial')).toHaveLength(2);
  });

  it('cambio de tenant con el mismo usuario: se vuelve a pedir', async () => {
    const e = crearEntorno('adm');
    let moneda = 'BOB';
    vi.spyOn(e.api, 'llamar').mockImplementation(((n: string) =>
      n === 'configuracionComercial' ? Promise.resolve({ mercados: [], monedasCaja: [moneda] }) : Promise.resolve({})) as never);
    const con = (tenantId: string): JSX.Element =>
      h(CtxApp.Provider, { value: { api: e.api, almacen: e.almacen, usuario: { ...usuarioDe('adm'), tenantId }, cerrarSesion: () => undefined, sesionVencida: () => undefined, renovarSesion: () => Promise.resolve(true), puedeVer: () => true } }, h(Sonda, {}));
    const { rerender } = render(con('uno'));
    await waitFor(() => expect(texto()).toBe('lista:sin-costo:BOB'));
    moneda = 'PEN';
    rerender(con('dos'));
    await waitFor(() => expect(texto()).toBe('lista:sin-costo:PEN'));
  });

  it('la misma sesión comparte una sola petición', async () => {
    const e = crearEntorno('adm');
    const espia = vi.spyOn(e.api, 'llamar');
    render(e.envolver(h('div', null, h(Sonda, {}), h(Sonda, {}))));
    await waitFor(() => expect(screen.getAllByText(/^lista:/)).toHaveLength(2));
    expect(espia.mock.calls.filter((c) => c[0] === 'configuracionComercial')).toHaveLength(1);
  });
});
