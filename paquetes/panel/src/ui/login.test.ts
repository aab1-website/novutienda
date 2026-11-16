// @vitest-environment jsdom
import { h } from 'preact';
import { act, cleanup, render, screen, waitFor } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SesionDoble } from '../sesion/doble.js';
import { ESPERA_RECUPERACION_S, Login, MENSAJE_RECUPERACION } from './login.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

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

  it('tras pedir el enlace espera 60 s antes de permitir otro, con el motivo a la vista', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const s = montar();
    const u = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    await u.type(screen.getByLabelText(/Correo/), 'adm@ejemplo.test');
    await u.click(screen.getByRole('button', { name: 'Olvidé mi contraseña' }));
    await screen.findByText(MENSAJE_RECUPERACION);
    expect(ESPERA_RECUPERACION_S).toBe(60);
    expect(screen.getByText(/Podrá pedir otro enlace en 60 s/)).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Olvidé mi contraseña' }));
    expect(s.restablecimientos).toHaveLength(1);
    for (let i = 0; i < 30; i += 1) await act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText(/Podrá pedir otro enlace en 30 s/)).toBeTruthy();
    for (let i = 0; i < 31; i += 1) await act(() => { vi.advanceTimersByTime(1000); });
    await waitFor(() => expect(screen.queryByText(/Podrá pedir otro enlace/)).toBeNull());
    await u.click(screen.getByRole('button', { name: 'Olvidé mi contraseña' }));
    expect(s.restablecimientos).toHaveLength(2);
  });

  it('al enviar el formulario la contraseña vuelve a ocultarse', async () => {
    montar();
    const u = userEvent.setup();
    await u.type(screen.getByLabelText(/Correo/), 'adm@ejemplo.test');
    await u.type(screen.getByLabelText(/Contraseña/), 'mal');
    await u.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect((screen.getByLabelText(/Contraseña/) as HTMLInputElement).type).toBe('text');
    await u.click(screen.getByRole('button', { name: 'Entrar' }));
    await screen.findByText(/no son correctos/);
    expect((screen.getByLabelText(/Contraseña/) as HTMLInputElement).type).toBe('password');
    expect(screen.getByRole('button', { name: 'Mostrar contraseña' }).hasAttribute('aria-pressed')).toBe(false);
  });
});

describe('ingreso: sin acceso y sin conexión', () => {
  it('«Volver a comprobar» repite el inicio de sesión y «Reintentar» lo repite ante un fallo de conexión', async () => {
    const sesion = new SesionDoble();
    const iniciar = vi
      .spyOn(sesion, 'iniciar')
      .mockResolvedValueOnce({ tipo: 'sin-acceso' })
      .mockResolvedValueOnce({ tipo: 'error', mensaje: 'No se pudo comprobar su acceso. Revise su conexión.' })
      .mockResolvedValue({ tipo: 'sin-acceso' });
    render(h(Login, { sesion, nombre: 'Panel' }));
    const u = userEvent.setup();
    await u.type(screen.getByLabelText(/Correo/), 'ana@ejemplo.test');
    await u.type(screen.getByLabelText(/Contraseña/), 'clave');
    await u.click(screen.getByRole('button', { name: 'Entrar' }));
    await u.click(await screen.findByRole('button', { name: 'Volver a comprobar' }));
    expect(await screen.findByText('No se pudo comprobar su acceso. Revise su conexión.')).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(iniciar).toHaveBeenCalledTimes(3));
    expect(await screen.findByRole('button', { name: 'Volver a comprobar' })).toBeTruthy();
  });
});

