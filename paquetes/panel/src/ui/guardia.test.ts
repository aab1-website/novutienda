// @vitest-environment jsdom
import { h, type JSX } from 'preact';
import { useState } from 'preact/hooks';
import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProveedorGuardia, useBorrador, useCambiosSinGuardar, useGuardia } from './guardia.js';

afterEach(() => {
  cleanup();
  window.location.hash = '';
});
beforeEach(() => {
  window.location.hash = '#/a';
});

function Editor({ sucio }: { sucio: boolean }): JSX.Element {
  useCambiosSinGuardar(sucio);
  const { confirmarSalida } = useGuardia();
  return h('div', null, h('a', { href: '#/b' }, 'Ir a B'), h('button', { type: 'button', onClick: () => confirmarSalida(() => document.body.setAttribute('data-salio', '1')) }, 'Salir'));
}
const montar = (sucio: boolean): void => {
  document.body.removeAttribute('data-salio');
  render(h(ProveedorGuardia, null, h(Editor, { sucio })));
};

describe('guardia de cambios sin guardar', () => {
  it('sin cambios no pregunta: el enlace navega y salir actúa', async () => {
    montar(false);
    const u = userEvent.setup();
    await u.click(screen.getByRole('link', { name: 'Ir a B' }));
    expect(window.location.hash).toBe('#/b');
    await u.click(screen.getByRole('button', { name: 'Salir' }));
    expect(document.body.getAttribute('data-salio')).toBe('1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('con cambios, un enlace interno pregunta; seguir editando no navega y descartar sí', async () => {
    montar(true);
    const u = userEvent.setup();
    await u.click(screen.getByRole('link', { name: 'Ir a B' }));
    expect(await screen.findByRole('dialog', { name: '¿Salir sin guardar?' })).toBeTruthy();
    expect(window.location.hash).toBe('#/a');
    await u.click(screen.getByRole('button', { name: 'Seguir editando' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.location.hash).toBe('#/a');
    await u.click(screen.getByRole('link', { name: 'Ir a B' }));
    await u.click(await screen.findByRole('button', { name: 'Salir sin guardar' }));
    expect(window.location.hash).toBe('#/b');
  });
  it('con cambios, salir pregunta antes de ejecutar', async () => {
    montar(true);
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'Salir' }));
    expect(document.body.getAttribute('data-salio')).toBeNull();
    await u.click(await screen.findByRole('button', { name: 'Salir sin guardar' }));
    expect(document.body.getAttribute('data-salio')).toBe('1');
  });
  it('«atrás» restaura la URL sin entradas nuevas y pregunta; descartar aplica el destino sin sumar historial', async () => {
    montar(true);
    const largo = window.history.length;
    window.history.replaceState(null, '', '#/c');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(window.location.hash).toBe('#/a');
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(window.history.length).toBe(largo);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Salir sin guardar' }));
    await waitFor(() => expect(window.location.hash).toBe('#/c'));
    expect(window.history.length).toBe(largo);
  });
  it('cerrar la pestaña pide confirmación solo con cambios', () => {
    montar(true);
    const con = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(con);
    expect(con.defaultPrevented).toBe(true);
    cleanup();
    montar(false);
    const sin = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(sin);
    expect(sin.defaultPrevented).toBe(false);
  });
  it('una vez guardado (sucio=false) la guardia se suelta', async () => {
    function Con(): JSX.Element {
      const [s, setS] = useState(true);
      return h('div', null, h(Editor, { sucio: s }), h('button', { type: 'button', onClick: () => setS(false) }, 'Guardar'));
    }
    render(h(ProveedorGuardia, null, h(Con, null)));
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'Guardar' }));
    await u.click(screen.getByRole('link', { name: 'Ir a B' }));
    expect(window.location.hash).toBe('#/b');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('borradores en memoria', () => {
  function Ficha({ clave }: { clave: string }): JSX.Element {
    const b = useBorrador(clave, '');
    return h('div', null, h('input', { 'aria-label': 'Nombre', value: b.valor, onInput: (e: Event) => b.poner((e.target as HTMLInputElement).value) }), h('button', { type: 'button', onClick: b.descartar }, 'Descartar'));
  }
  function Pestanas(): JSX.Element {
    const [t, setT] = useState('uno');
    return h('div', null, h('button', { type: 'button', onClick: () => setT('uno') }, 'Uno'), h('button', { type: 'button', onClick: () => setT('dos') }, 'Dos'), t === 'uno' ? h(Ficha, { clave: 'ficha' }) : h('p', null, 'Otra pestaña'));
  }
  it('sobreviven al cambio de pestaña y no tocan el almacenamiento del dispositivo', async () => {
    render(h(ProveedorGuardia, null, h(Pestanas, null)));
    const u = userEvent.setup();
    await u.type(screen.getByLabelText('Nombre'), 'Borrador');
    await u.click(screen.getByRole('button', { name: 'Dos' }));
    expect(screen.queryByLabelText('Nombre')).toBeNull();
    await u.click(screen.getByRole('button', { name: 'Uno' }));
    expect((screen.getByLabelText('Nombre') as HTMLInputElement).value).toBe('Borrador');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
  it('descartar restaura el valor inicial; al desmontar el proveedor se pierden', async () => {
    const r = render(h(ProveedorGuardia, null, h(Ficha, { clave: 'ficha' })));
    const u = userEvent.setup();
    await u.type(screen.getByLabelText('Nombre'), 'x');
    await u.click(screen.getByRole('button', { name: 'Descartar' }));
    expect((screen.getByLabelText('Nombre') as HTMLInputElement).value).toBe('');
    await u.type(screen.getByLabelText('Nombre'), 'y');
    r.unmount();
    render(h(ProveedorGuardia, null, h(Ficha, { clave: 'ficha' })));
    expect((screen.getByLabelText('Nombre') as HTMLInputElement).value).toBe('');
  });
});
