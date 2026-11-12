// @vitest-environment jsdom
import { h, type JSX } from 'preact';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearEntorno } from '../ayuda-pruebas.js';
import { ErrorApi } from '../api/errores.js';
import { useAccion, useCarga } from './hooks.js';

afterEach(cleanup);

describe('useCarga', () => {
  function Caso(p: { fn: () => Promise<string> }): JSX.Element {
    const c = useCarga(p.fn, []);
    return h('div', null, h('p', { 'data-prueba': 'estado' }, `${c.datos ?? '-'}|${c.error ?? '-'}`), h('button', { type: 'button', onClick: c.recargar }, 'Recargar'));
  }

  it('carga y traduce el error', async () => {
    render(h(Caso, { fn: () => Promise.reject(new ErrorApi('unavailable', 'x')) }));
    await waitFor(() => expect(document.querySelector('[data-prueba="estado"]')?.textContent).toMatch(/^-\|[^-]/));
  });

  it('unauthenticated con renovación fallida avisa a la aplicación que la sesión venció; otros errores no', async () => {
    const entorno = crearEntorno('adm');
    entorno.renovacion.acepta = false;
    render(entorno.envolver(h(Caso, { fn: () => Promise.reject(new ErrorApi('unauthenticated', 'x')) })));
    await waitFor(() => expect(entorno.sesionesVencidas()).toBeGreaterThan(0));
    cleanup();
    const otro = crearEntorno('adm');
    render(otro.envolver(h(Caso, { fn: () => Promise.reject(new ErrorApi('unavailable', 'x')) })));
    await waitFor(() => expect(document.querySelector('[data-prueba="estado"]')?.textContent).not.toBe('-|-'));
    expect(otro.sesionesVencidas()).toBe(0);
  });

  it('unauthenticated con token renovable: se reintenta una vez y no se cierra la sesión', async () => {
    const entorno = crearEntorno('adm');
    let n = 0;
    const fn = (): Promise<string> => (++n === 1 ? Promise.reject(new ErrorApi('unauthenticated', 'x')) : Promise.resolve('bien'));
    render(entorno.envolver(h(Caso, { fn })));
    await waitFor(() => expect(document.querySelector('[data-prueba="estado"]')?.textContent).toBe('bien|-'));
    expect(entorno.renovacion.llamadas).toBe(1);
    expect(n).toBe(2);
    expect(entorno.sesionesVencidas()).toBe(0);
  });

  it('unauthenticated que no es de sesión (App Check) con token válido: error normal con el mensaje del servidor, sin cerrar sesión ni bucle', async () => {
    const entorno = crearEntorno('adm');
    const fn = vi.fn(() => Promise.reject(new ErrorApi('unauthenticated', 'La aplicación no está verificada (App Check).')));
    render(entorno.envolver(h(Caso, { fn })));
    await waitFor(() => expect(document.querySelector('[data-prueba="estado"]')?.textContent).toMatch(/^-\|[^-]/));
    expect(document.querySelector('[data-prueba="estado"]')?.textContent).toContain('App Check');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(entorno.renovacion.llamadas).toBe(1);
    expect(entorno.sesionesVencidas()).toBe(0);
  });

  it('con el token renovado, si el servidor sigue diciendo que la sesión no vale, la sesión venció', async () => {
    const entorno = crearEntorno('adm');
    render(entorno.envolver(h(Caso, { fn: () => Promise.reject(new ErrorApi('unauthenticated', 'La sesión no es válida o fue revocada. Vuelva a iniciar sesión.')) })));
    await waitFor(() => expect(entorno.sesionesVencidas()).toBeGreaterThan(0));
    expect(entorno.renovacion.llamadas).toBe(1);
  });

  it('un recargar con las mismas dependencias que falla conserva los datos y deja el error', async () => {
    let n = 0;
    const fn = (): Promise<string> => (++n === 1 ? Promise.resolve('bien') : Promise.reject(new ErrorApi('unavailable', 'x')));
    render(h(Caso, { fn }));
    await waitFor(() => expect(document.querySelector('[data-prueba="estado"]')?.textContent).toBe('bien|-'));
    fireEvent.click(screen.getByRole('button', { name: 'Recargar' }));
    await waitFor(() => expect(document.querySelector('[data-prueba="estado"]')?.textContent?.startsWith('bien|')).toBe(true));
    await waitFor(() => expect(document.querySelector('[data-prueba="estado"]')?.textContent).not.toBe('bien|-'));
  });
});

describe('useAccion', () => {
  function Caso(p: { fn: () => Promise<unknown> }): JSX.Element {
    const a = useAccion();
    return h('div', null, h('button', { type: 'button', onClick: () => void a.ejecutar(p.fn) }, 'Ir'), h('p', { 'data-prueba': 'error' }, a.error ?? '-'));
  }

  it('unauthenticated con renovación fallida avisa que la sesión venció y no deja error local', async () => {
    const entorno = crearEntorno('adm');
    entorno.renovacion.acepta = false;
    render(entorno.envolver(h(Caso, { fn: () => Promise.reject(new ErrorApi('unauthenticated', 'x')) })));
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Ir' })));
    await waitFor(() => expect(entorno.sesionesVencidas()).toBe(1));
    expect(document.querySelector('[data-prueba="error"]')?.textContent).toBe('-');
  });

  it('unauthenticated con token renovable: la acción se reintenta una vez y la sesión sigue', async () => {
    const entorno = crearEntorno('adm');
    let n = 0;
    const fn = vi.fn(() => (++n === 1 ? Promise.reject(new ErrorApi('unauthenticated', 'x')) : Promise.resolve('listo')));
    render(entorno.envolver(h(Caso, { fn })));
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Ir' })));
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
    expect(entorno.sesionesVencidas()).toBe(0);
    expect(document.querySelector('[data-prueba="error"]')?.textContent).toBe('-');
  });

  it('unauthenticated de App Check con token válido: error local con el mensaje del servidor, sin cerrar sesión', async () => {
    const entorno = crearEntorno('adm');
    const fn = vi.fn(() => Promise.reject(new ErrorApi('unauthenticated', 'La aplicación no está verificada (App Check).')));
    render(entorno.envolver(h(Caso, { fn })));
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Ir' })));
    await waitFor(() => expect(document.querySelector('[data-prueba="error"]')?.textContent).toContain('App Check'));
    expect(fn).toHaveBeenCalledTimes(2);
    expect(entorno.sesionesVencidas()).toBe(0);
  });

  it('evita el doble envío mientras está ocupada', async () => {
    const fn = vi.fn(() => new Promise<void>((r) => setTimeout(r, 20)));
    render(h(Caso, { fn }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ir' }));
      fireEvent.click(screen.getByRole('button', { name: 'Ir' }));
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
