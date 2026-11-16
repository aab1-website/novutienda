// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, render, screen } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { SesionDoble } from '../sesion/doble.js';
import { Login, MENSAJE_RECUPERACION } from './login.js';

afterEach(cleanup);

const montar = (): SesionDoble => {
  const sesion = new SesionDoble();
  render(h(Login, { sesion, nombre: 'Panel' }));
  return sesion;
};

describe('ingreso: recuperar y mostrar la contraseña', () => {
  it('mostrar contraseña alterna el tipo del campo y el texto del botón', async () => {
    montar();
    const u = userEvent.setup();
    const clave = screen.getByLabelText(/Contraseña/) as HTMLInputElement;
    expect(clave.type).toBe('password');
    await u.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(clave.type).toBe('text');
    await u.click(screen.getByRole('button', { name: 'Ocultar contraseña' }));
    expect(clave.type).toBe('password');
  });

  it('«Olvidé mi contraseña» envía el correo de restablecimiento y responde en términos genéricos', async () => {
    const s = montar();
    const u = userEvent.setup();
    await u.type(screen.getByLabelText(/Correo/), ' ADM@ejemplo.test ');
    await u.click(screen.getByRole('button', { name: 'Olvidé mi contraseña' }));
    expect((await screen.findByText(MENSAJE_RECUPERACION)).textContent).toMatch(/^Si el correo tiene una cuenta, le llegará un enlace/);
    expect(s.restablecimientos).toEqual(['adm@ejemplo.test']);
  });

  it('la respuesta es idéntica si la cuenta no existe, y no se envía nada', async () => {
    const s = montar();
    const u = userEvent.setup();
    await u.type(screen.getByLabelText(/Correo/), 'nadie@ejemplo.test');
    await u.click(screen.getByRole('button', { name: 'Olvidé mi contraseña' }));
    expect(await screen.findByText(MENSAJE_RECUPERACION)).toBeTruthy();
    expect(s.restablecimientos).toEqual([]);
    expect(screen.queryByText(/no existe|no se encontró|no está registrad/i)).toBeNull();
  });

  it('un fallo del servicio tampoco cambia la respuesta ni muestra error', async () => {
    const s = new SesionDoble();
    s.recuperarContrasena = () => Promise.reject(new Error('auth/user-not-found'));
    render(h(Login, { sesion: s, nombre: 'Panel' }));
    const u = userEvent.setup();
    await u.type(screen.getByLabelText(/Correo/), 'nadie@ejemplo.test');
    await u.click(screen.getByRole('button', { name: 'Olvidé mi contraseña' }));
    expect(await screen.findByText(MENSAJE_RECUPERACION)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('sin correo escrito pide el correo y no llama al servicio', async () => {
    const s = montar();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Olvidé mi contraseña' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Escriba su correo');
    expect(s.restablecimientos).toEqual([]);
  });

  it('todo el trato es de «usted»', async () => {
    const s = montar();
    const u = userEvent.setup();
    await u.type(screen.getByLabelText(/Correo/), 'nuevo@ejemplo.test');
    await u.type(screen.getByLabelText(/Contraseña/), 'clave-nuevo-1');
    await u.click(screen.getByRole('button', { name: 'Entrar' }));
    const aviso = await screen.findByText(/Verifique su correo/);
    expect(aviso.textContent).not.toMatch(/\b(tu|te|tus|verifica)\b/i);
    expect(s.actual()).toBeNull();
  });
});
