// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, render, screen, waitFor, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crearEntorno } from '../ayuda-pruebas.js';
import { SesionDoble } from '../sesion/doble.js';
import { App } from './app.js';

afterEach(() => {
  cleanup();
  window.location.hash = '';
  localStorage.clear();
});
beforeEach(() => {
  window.location.hash = '';
});

function montar(apagar: readonly string[] = []): { sesion: SesionDoble } {
  const sesion = new SesionDoble();
  const entorno = crearEntorno('caj');
  // La sesión manda: el doble de la API toma el usuario de la sesión.
  const api = new (entorno.api.constructor as new (o: { usuario: () => { uid: string; rol: 'caj' | 'sup' | 'adm' } }) => typeof entorno.api)({
    usuario: () => sesion.actual() ?? { uid: 'anonimo', rol: 'caj' },
  });
  api.estado.modulos = api.estado.modulos.filter((m) => !apagar.includes(m));
  render(h(App, { sesion, api, almacen: entorno.almacen }));
  return { sesion };
}

async function entrar(correo: string, clave: string): Promise<void> {
  const u = userEvent.setup();
  await u.type(screen.getByLabelText(/Correo/), correo);
  await u.type(screen.getByLabelText(/Contraseña/), clave);
  await u.click(screen.getByRole('button', { name: 'Entrar' }));
}

describe('inicio de sesión', () => {
  it('un correo no verificado muestra «verifica tu correo» y no entra', async () => {
    montar();
    await entrar('nuevo@ejemplo.test', 'clave-nuevo-1');
    expect(await screen.findByText(/Verifica tu correo/)).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Menú principal' })).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reenviar enlace' }));
    expect(await screen.findByText(/Enlace reenviado/)).toBeTruthy();
  });
  it('credenciales incorrectas muestran un mensaje legible', async () => {
    montar();
    await entrar('adm@ejemplo.test', 'incorrecta');
    expect((await screen.findByRole('alert')).textContent).toContain('no son correctos');
  });
  it('el botón Entrar espera correo y contraseña', () => {
    montar();
    expect((screen.getByRole('button', { name: 'Entrar' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('menú por rol', () => {
  const items = (): string[] => within(screen.getByRole('navigation', { name: 'Menú principal' })).getAllByRole('link').map((a) => a.textContent ?? '');
  it('vendedor: Venta y Mis recibos', async () => {
    montar();
    await entrar('caj@ejemplo.test', 'clave-caj-1');
    await screen.findByRole('navigation', { name: 'Menú principal' });
    expect(items()).toEqual(['Venta', 'Mis recibos']);
    await waitFor(() => expect(window.location.hash).toBe('#/venta/terminal'));
  });
  it('supervisor agrega Inventario, Mermas, Aprobaciones y Supervisión', async () => {
    montar();
    await entrar('sup@ejemplo.test', 'clave-sup-1');
    await screen.findByRole('navigation', { name: 'Menú principal' });
    expect(items()).toEqual(['Venta', 'Recibos', 'Inventario', 'Mermas', 'Aprobaciones', 'Supervisión', 'Catálogo y sitio']);
  });
  it('administrador ve todo, incluidos Usuarios y Configuración', async () => {
    montar();
    await entrar('adm@ejemplo.test', 'clave-adm-1');
    await screen.findByRole('navigation', { name: 'Menú principal' });
    expect(items()).toEqual(['Venta', 'Recibos', 'Inventario', 'Mermas', 'Aprobaciones', 'Supervisión', 'Catálogo y sitio', 'Usuarios', 'Configuración']);
  });
  it('una ruta fuera del rol muestra «no tiene acceso» y salir vuelve al ingreso', async () => {
    montar();
    await entrar('caj@ejemplo.test', 'clave-caj-1');
    await screen.findByRole('navigation', { name: 'Menú principal' });
    window.location.hash = '#/usuarios';
    expect(await screen.findByText('No tiene acceso a esta página')).toBeTruthy();
    window.location.hash = '#/nada';
    expect(await screen.findByText('Esta página no existe')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Salir' }));
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeTruthy();
  });
  it('pos apagado: el menú no muestra «Venta» y #/venta dice que no tiene acceso', async () => {
    montar(['pos']);
    await entrar('adm@ejemplo.test', 'clave-adm-1');
    await screen.findByRole('navigation', { name: 'Menú principal' });
    expect(items()).toEqual(['Recibos', 'Inventario', 'Mermas', 'Catálogo y sitio', 'Usuarios', 'Configuración']);
    await waitFor(() => expect(window.location.hash).toBe('#/recibos'));
    window.location.hash = '#/venta';
    expect(await screen.findByText('No tiene acceso a esta página')).toBeTruthy();
  });
  it('si modulosActivos falla, el menú solo muestra Central', async () => {
    const sesion = new SesionDoble();
    const entorno = crearEntorno('adm');
    const api = { llamar: () => Promise.reject(new Error('sin conexión')) } as unknown as typeof entorno.api;
    render(h(App, { sesion, api, almacen: entorno.almacen }));
    await entrar('adm@ejemplo.test', 'clave-adm-1');
    await screen.findByRole('navigation', { name: 'Menú principal' });
    expect(items()).toEqual(['Usuarios', 'Configuración']);
  });
  it('el tema se puede alternar y se recuerda', async () => {
    montar();
    await entrar('caj@ejemplo.test', 'clave-caj-1');
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Tema: automático' }));
    expect(document.documentElement.getAttribute('data-tema')).toBe('oscuro');
    await u.click(screen.getByRole('button', { name: 'Tema: oscuro' }));
    expect(document.documentElement.getAttribute('data-tema')).toBe('claro');
    expect(localStorage.getItem('panel.tema')).toBe('claro');
    await u.click(screen.getByRole('button', { name: 'Tema: claro' }));
    expect(document.documentElement.hasAttribute('data-tema')).toBe(false);
  });
});
