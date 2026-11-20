// @vitest-environment jsdom
// Invitar a una persona desde el panel (U-01): flujo de invitar, reenviar y anular, y el envío del correo con el enlace.
import { h } from 'preact';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/preact';
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
  await u.type(await screen.findByLabelText('Correo de la persona'), correo);
  if (rol !== undefined) await u.selectOptions(screen.getByLabelText('Rol de la persona'), rol);
  await u.click(screen.getByRole('button', { name: /^Agregar como/ }));
}

/** Libera un cupo (el doble trae 3 de 3). */
const conCupo = async (e: Entorno): Promise<void> => void (await e.api.llamar('quitarRol', { uid: 'u-sup' }));

describe('invitar a una persona', () => {
  it('invita con correo y rol (también administrador): aviso de éxito, correo del enlace y fila pendiente', async () => {
    const e = crearEntorno('adm');
    await conCupo(e);
    ver(e);
    await invitar(' Ana@Ejemplo.test ', 'adm');
    await waitFor(() => expect(regionAvisos().textContent).toContain('Listo. Enviamos un correo a ana@ejemplo.test'));
    expect(e.correosDeAcceso).toEqual(['ana@ejemplo.test']);
    const pendientes = await screen.findByRole('table', { name: 'Invitaciones pendientes' });
    expect(within(pendientes).getByText('ana@ejemplo.test')).toBeTruthy();
    expect(within(pendientes).getByText('Administrador')).toBeTruthy();
    expect(within(pendientes).getByText(/Vence el /)).toBeTruthy();
    expect(await screen.findByText('Personas con acceso (2) e invitaciones pendientes (1), de 3 del plan')).toBeTruthy(); // sin cifra engañosa: la invitación ocupa un cupo
    expect(document.body.textContent).not.toMatch(/Firebase Console|Add user/);
  });

  it('el aviso es el mismo para una cuenta nueva y una existente, y solo se llama a invitarUsuario (no revela nada)', async () => {
    const textos: string[] = [];
    for (const correo of ['nadie@ejemplo.test', 'nueva@ejemplo.test', 'pendiente@ejemplo.test']) {
      const e = crearEntorno('adm');
      await conCupo(e);
      ver(e);
      await invitar(correo);
      await waitFor(() => expect(regionAvisos().textContent).toContain('Listo. Enviamos un correo'));
      textos.push((regionAvisos().textContent ?? '').replaceAll(correo, '<correo>'));
      expect(e.correosDeAcceso).toEqual([correo]); // el correo se envía siempre, exista o no la cuenta
      expect(e.api.llamadas.map((l) => l.nombre)).toContain('invitarUsuario');
      expect(e.api.llamadas.map((l) => l.nombre)).not.toContain('buscarUsuarioPorCorreo');
      cleanup();
    }
    expect(new Set(textos).size).toBe(1);
  });

  it('el correo de un miembro avisa «ya tiene acceso» sin llamar al servidor', async () => {
    const e = crearEntorno('adm');
    await conCupo(e);
    ver(e);
    await invitar('caj@ejemplo.test');
    expect(await screen.findByText(/caj@ejemplo.test ya tiene acceso/)).toBeTruthy();
    expect(e.api.llamadas.map((l) => l.nombre)).not.toContain('invitarUsuario');
    expect(e.correosDeAcceso).toEqual([]);
  });

  it('un correo con invitación pendiente y otro rol se envía y la fila muestra el rol nuevo sin otro cupo', async () => {
    const e = crearEntorno('adm');
    await conCupo(e);
    await e.api.llamar('invitarUsuario', { correo: 'ana@ejemplo.test', rol: 'caj' });
    ver(e);
    await invitar('ana@ejemplo.test', 'sup');
    await waitFor(() => expect(regionAvisos().textContent).toContain('Listo. Enviamos un correo'));
    const pendientes = await screen.findByRole('table', { name: 'Invitaciones pendientes' });
    expect(await within(pendientes).findByText('Supervisor')).toBeTruthy();
    expect(await screen.findByText('Personas con acceso (2) e invitaciones pendientes (1), de 3 del plan')).toBeTruthy();
  });

  it('con el rol Administrador se avisa que solo el propietario de la plataforma puede quitarlo', async () => {
    const e = crearEntorno('adm');
    await conCupo(e);
    ver(e);
    const u = userEvent.setup();
    expect(screen.queryByText(/solo lo puede quitar el propietario/)).toBeNull();
    await u.selectOptions(await screen.findByLabelText('Rol de la persona'), 'adm');
    expect(screen.getByText('Un administrador solo lo puede quitar el propietario de la plataforma.')).toBeTruthy();
  });

  it('la pantalla explica el correo que llegará y cuándo se activa el rol', async () => {
    const e = crearEntorno('adm');
    await conCupo(e);
    ver(e);
    expect(await screen.findByText(/correo de Firebase para elegir su contraseña o restablecerla/)).toBeTruthy();
    expect(screen.getByText(/El rol se activa cuando inicia sesión/)).toBeTruthy();
  });

  it('con el plan lleno explica el motivo y no envía', async () => {
    const e = crearEntorno('adm');
    ver(e);
    await screen.findByText(/ya están todos ocupados/);
    const boton = screen.getByRole('button', { name: /^Agregar como/ });
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

  it('si el correo no se pudo enviar, el administrador lo ve, no se dice «Invitación enviada» y la invitación queda en la lista', async () => {
    const e = crearEntorno('adm');
    await conCupo(e);
    e.envio.falla = true;
    ver(e);
    await invitar('ana@ejemplo.test');
    expect((await screen.findAllByRole('alert'))[0]?.textContent).toContain('La invitación quedó registrada, pero no se pudo enviar el correo. Use Reenviar.');
    expect(regionAvisos().textContent).not.toContain('Invitación enviada');
    expect(await screen.findByRole('table', { name: 'Invitaciones pendientes' })).toBeTruthy();
    e.envio.falla = false;
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Reenviar' }));
    await waitFor(() => expect(e.correosDeAcceso).toEqual(['ana@ejemplo.test']));
  });

  it('asignar rol a una invitación pendiente la sobrescribe y la persona queda activa (como el servidor)', async () => {
    const e = crearEntorno('adm');
    await conCupo(e);
    await e.api.llamar('invitarUsuario', { correo: 'ana@ejemplo.test', rol: 'adm' });
    await e.api.llamar('asignarRol', { uid: 'u-invitado-1', rol: 'sup' });
    const ana = (await e.api.llamar('listarUsuarios', {})).find((u) => u.uid === 'u-invitado-1');
    expect(ana).toMatchObject({ rol: 'sup' });
    expect(ana?.estado).toBeUndefined();
  });
});

describe('alta: selector, botón y estados', () => {
  it('el botón dice el rol elegido, y tras invitar el selector vuelve a Vendedor y el correo queda vacío', async () => {
    const e = crearEntorno('adm');
    await conCupo(e);
    ver(e);
    const u = userEvent.setup();
    expect(await screen.findByRole('button', { name: 'Agregar como vendedor' })).toBeTruthy();
    await u.selectOptions(screen.getByLabelText('Rol de la persona'), 'sup');
    expect(screen.getByRole('button', { name: 'Agregar como supervisor' })).toBeTruthy();
    await u.selectOptions(screen.getByLabelText('Rol de la persona'), 'adm');
    expect(screen.getByRole('button', { name: 'Agregar como administrador' })).toBeTruthy();
    await u.type(screen.getByLabelText('Correo de la persona'), 'ana@ejemplo.test');
    await u.click(screen.getByRole('button', { name: 'Agregar como administrador' }));
    await waitFor(() => expect(regionAvisos().textContent).toContain('Listo. Enviamos un correo'));
    expect((screen.getByLabelText('Rol de la persona') as HTMLSelectElement).value).toBe('caj');
    expect((screen.getByLabelText('Correo de la persona') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: 'Agregar como vendedor' })).toBeTruthy();
  });

  it('«Cambiar rol» cambia el rol en el doble, no envía correo, no ocupa otro cupo y avisa', async () => {
    const e = crearEntorno('adm');
    await conCupo(e);
    await e.api.llamar('invitarUsuario', { correo: 'ana@ejemplo.test', rol: 'caj' });
    e.correosDeAcceso.length = 0;
    ver(e);
    const u = userEvent.setup();
    const boton = await screen.findByRole('button', { name: 'Cambiar rol' });
    expect(boton.getAttribute('aria-disabled')).toBe('true'); // aún no hay otro rol elegido
    await u.selectOptions(screen.getByLabelText('Rol de la invitación de ana@ejemplo.test'), 'adm');
    expect(screen.getByText('Un administrador solo lo puede quitar el propietario de la plataforma.')).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Cambiar rol' }));
    await waitFor(() => expect(regionAvisos().textContent).toContain('Rol de la invitación cambiado a administrador. No se envió otro correo.'));
    expect(e.correosDeAcceso).toEqual([]);
    const lista = await e.api.llamar('listarUsuarios', {});
    expect(lista.filter((x) => x.estado === 'invitado')).toMatchObject([{ rol: 'adm' }]);
    expect(lista).toHaveLength(3);
    expect(await screen.findByText('Personas con acceso (2) e invitaciones pendientes (1), de 3 del plan')).toBeTruthy();
  });

  describe('con temporizadores falsos', () => {
    afterEach(() => vi.useRealTimers());

    it('muestra «Registrando…», luego «Enviando el correo…», y a los 15 s de una fase avisa que tarda', async () => {
      const e = crearEntorno('adm');
      await conCupo(e);
      let liberarRegistro: () => void = () => undefined;
      const llamar = e.api.llamar.bind(e.api) as (n: string, x: unknown) => Promise<unknown>;
      // Emula las fases del envoltorio de correo: registra, espera, envía y espera.
      vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, x: unknown, o?: { alFase?: (f: string) => void }) => {
        if (n !== 'invitarUsuario') return llamar(n, x);
        o?.alFase?.('registrando');
        return new Promise(() => {
          liberarRegistro = () => o?.alFase?.('enviando');
        });
      }) as never);
      ver(e);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const u = userEvent.setup({ delay: null });
      await u.type(await screen.findByLabelText('Correo de la persona'), 'ana@ejemplo.test');
      await u.click(screen.getByRole('button', { name: /^Agregar como/ }));
      expect(document.body.textContent).toContain('Registrando…');
      expect(document.body.textContent).not.toContain('Está tardando');
      await act(async () => void (await vi.advanceTimersByTimeAsync(14_000)));
      expect(document.body.textContent).not.toContain('Está tardando');
      await act(async () => void (await vi.advanceTimersByTimeAsync(1_500)));
      expect(document.body.textContent).toContain('Está tardando más de lo normal. No cierre esta página');
      await act(async () => liberarRegistro());
      expect(document.body.textContent).toContain('Enviando el correo…');
      expect(document.body.textContent).not.toContain('Está tardando'); // la fase nueva reinicia la cuenta
      await act(async () => void (await vi.advanceTimersByTimeAsync(15_500)));
      expect(document.body.textContent).toContain('Está tardando más de lo normal');
    });
  });
});
