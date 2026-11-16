// @vitest-environment jsdom
// Invitar a una persona desde el panel (U-01): flujo de invitar, reenviar y anular, y el envío del correo con el enlace.
import { h } from 'preact';
import { cleanup, render, screen, waitFor, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorApi } from '../api/errores.js';
import { crearEntorno, type Entorno } from '../ayuda-pruebas.js';
import { PantallaUsuarios } from './usuarios.js';


afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ver = (e: Entorno): void => void render(e.envolver(h(PantallaUsuarios, {})));
const regionAvisos = (): HTMLElement => document.querySelector('[data-region="avisos-estado"]') as HTMLElement;

async function invitar(correo: string, rol?: string): Promise<void> {
  const u = userEvent.setup();
  await u.type(await screen.findByLabelText('Correo para invitar'), correo);
  if (rol !== undefined) await u.selectOptions(screen.getByLabelText('Rol de la invitación'), rol);
  await u.click(screen.getByRole('button', { name: 'Invitar' }));
}

/** Libera un cupo (el doble trae 3 de 3). */
const conCupo = async (e: Entorno): Promise<void> => void (await e.api.llamar('quitarRol', { uid: 'u-sup' }));

describe('invitar a una persona', () => {
  it('invita con correo y rol (también administrador): aviso «Invitación enviada», correo del enlace y fila pendiente', async () => {
    const e = crearEntorno('adm');
    await conCupo(e);
    ver(e);
    await invitar(' Ana@Ejemplo.test ', 'adm');
    await waitFor(() => expect(regionAvisos().textContent).toContain('Invitación enviada'));
    expect(e.correosDeAcceso).toEqual(['ana@ejemplo.test']);
    const pendientes = await screen.findByRole('table', { name: 'Invitaciones pendientes' });
    expect(within(pendientes).getByText('ana@ejemplo.test')).toBeTruthy();
    expect(within(pendientes).getByText('Administrador')).toBeTruthy();
    expect(within(pendientes).getByText(/Vence el /)).toBeTruthy();
    expect(await screen.findByText('Personas con acceso (3 de 3)')).toBeTruthy(); // la invitación ocupa el cupo
    expect(document.body.textContent).not.toMatch(/Firebase Console|Add user/);
  });

  it('el aviso es el mismo para una cuenta nueva, una existente y un miembro (no revela nada)', async () => {
    const textos: string[] = [];
    for (const correo of ['nadie@ejemplo.test', 'nueva@ejemplo.test', 'caj@ejemplo.test']) {
      const e = crearEntorno('adm');
      await conCupo(e);
      ver(e);
      await invitar(correo);
      await waitFor(() => expect(regionAvisos().textContent).toContain('Invitación enviada'));
      textos.push(regionAvisos().textContent ?? '');
      expect(e.correosDeAcceso).toEqual([correo]); // el correo se envía siempre, exista o no la cuenta
      cleanup();
    }
    expect(new Set(textos).size).toBe(1);
  });

  it('con el plan lleno explica el motivo y no envía', async () => {
    const e = crearEntorno('adm');
    ver(e);
    await screen.findByText(/ya están todos ocupados/);
    const boton = screen.getByRole('button', { name: 'Invitar' });
    expect(boton.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(/no tiene cupos libres/)).toBeTruthy();
    await userEvent.setup().click(boton);
    expect(e.api.llamadas.map((l) => l.nombre)).not.toContain('invitarUsuario');
  });

  it('si el servidor rechaza por cupo, muestra el motivo; el límite por hora tiene su propio aviso', async () => {
    const e = crearEntorno('adm');
    await conCupo(e);
    const llamar = e.api.llamar.bind(e.api) as (n: string, x: unknown) => Promise<unknown>;
    vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, x: unknown) =>
      n === 'invitarUsuario' ? Promise.reject(new ErrorApi('resource-exhausted', 'x', { codigo: 'limite-invitaciones' })) : llamar(n, x)) as never);
    ver(e);
    await invitar('otra@ejemplo.test');
    expect((await screen.findAllByRole('alert'))[0]?.textContent).toContain('demasiadas invitaciones');
    expect(e.correosDeAcceso).toEqual([]);
  });

  it('reenviar extiende el vencimiento y vuelve a enviar el correo', async () => {
    const e = crearEntorno('adm');
    await conCupo(e);
    await e.api.llamar('invitarUsuario', { correo: 'ana@ejemplo.test', rol: 'sup' });
    e.correosDeAcceso.length = 0;
    ver(e);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Reenviar' }));
    await waitFor(() => expect(regionAvisos().textContent).toContain('Invitación enviada'));
    expect(e.correosDeAcceso).toEqual(['ana@ejemplo.test']);
    expect(e.api.llamadas.filter((l) => l.nombre === 'reenviarInvitacion')).toHaveLength(1);
  });

  it('anular pide confirmación, libera el cupo y quita la fila', async () => {
    const e = crearEntorno('adm');
    await conCupo(e);
    await e.api.llamar('invitarUsuario', { correo: 'ana@ejemplo.test', rol: 'caj' });
    ver(e);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Anular' }));
    expect(await screen.findByText('¿Anular la invitación de ana@ejemplo.test?')).toBeTruthy();
    expect(e.api.llamadas.map((l) => l.nombre)).not.toContain('anularInvitacion');
    await u.click(screen.getByRole('button', { name: 'Sí, anular' }));
    expect(await screen.findByText('Invitación anulada.')).toBeTruthy();
    expect(await screen.findByText('Personas con acceso (2 de 3)')).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Invitaciones pendientes' })).toBeNull();
  });

  it('una invitación pendiente no aparece entre las personas con acceso ni se puede quitar como miembro', async () => {
    const e = crearEntorno('adm');
    await conCupo(e);
    await e.api.llamar('invitarUsuario', { correo: 'ana@ejemplo.test', rol: 'caj' });
    ver(e);
    const tabla = await screen.findByRole('table', { name: 'Usuarios del negocio' });
    expect(within(tabla).queryByText('ana@ejemplo.test')).toBeNull();
    await expect(e.api.llamar('quitarRol', { uid: 'u-invitado-1' })).rejects.toBeInstanceOf(ErrorApi);
  });

  it('un supervisor no ve las invitaciones pendientes', async () => {
    const e = crearEntorno('adm');
    await conCupo(e);
    await e.api.llamar('invitarUsuario', { correo: 'ana@ejemplo.test', rol: 'caj' });
    e.como('sup');
    expect((await e.api.llamar('listarUsuarios', {})).some((x) => x.estado === 'invitado')).toBe(false);
  });
});
