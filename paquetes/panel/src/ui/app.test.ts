// @vitest-environment jsdom
import { h } from 'preact';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearEntorno } from '../ayuda-pruebas.js';
import { CUENTAS_DOBLE, SesionDoble } from '../sesion/doble.js';
import { ErrorApi } from '../api/errores.js';
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
  it('un correo no verificado muestra «verifique su correo» y no entra', async () => {
    montar();
    await entrar('nuevo@ejemplo.test', 'clave-nuevo-1');
    expect(await screen.findByText(/Verifique su correo/)).toBeTruthy();
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

describe('identificador del comercio', () => {
  const cuentas = [
    ...CUENTAS_DOBLE,
    { correo: 'otro@ejemplo.test', contrasena: 'clave-otro-1', uid: 'u-otro', tenantId: 'otro-comercio', rol: 'adm' as const, verificado: true },
  ];
  function montarCon(): SesionDoble {
    const sesion = new SesionDoble(cuentas);
    const entorno = crearEntorno('caj');
    render(h(App, { sesion, api: entorno.api, almacen: entorno.almacen }));
    return sesion;
  }
  it('no aparece en el ingreso', () => {
    montarCon();
    expect(screen.queryByText(/Comercio:/)).toBeNull();
    expect(document.title).toBe('Ingreso · Panel de gestión');
  });
  it('ni la cabecera ni el título de la pestaña llevan el identificador del comercio', async () => {
    montarCon();
    await entrar('adm@ejemplo.test', 'clave-adm-1');
    const cab = await screen.findByRole('banner');
    await waitFor(() => expect(document.title).toBe('Venta · Panel de gestión'));
    expect(cab.textContent).not.toContain('demo');
    expect(within(cab).queryByText(/Comercio:/)).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Salir' }));
    await screen.findByRole('button', { name: 'Entrar' });
    await entrar('otro@ejemplo.test', 'clave-otro-1');
    const cab2 = await screen.findByRole('banner');
    await waitFor(() => expect(document.title).toBe('Venta · Panel de gestión'));
    expect(cab2.textContent).not.toContain('otro-comercio');
    expect(document.title).not.toContain('otro-comercio');
  });
});

describe('avisos y cambio de usuario', () => {
  it('un error visible no pasa a la persona que entra después de «Salir»', async () => {
    const sesion = new SesionDoble();
    const entorno = crearEntorno('adm');
    const base = entorno.api;
    const api = {
      llamar: (nombre: string, ...resto: unknown[]) => (nombre === 'guardarPlantilla' ? Promise.reject(new Error('La plantilla no se pudo guardar.')) : (base.llamar as (...a: unknown[]) => Promise<unknown>)(nombre, ...resto)),
    } as unknown as typeof entorno.api;
    render(h(App, { sesion, api, almacen: entorno.almacen }));
    await entrar('adm@ejemplo.test', 'clave-adm-1');
    await screen.findByRole('navigation', { name: 'Menú principal' });
    window.location.hash = '#/configuracion';
    const u = userEvent.setup();
    await screen.findByRole('heading', { name: 'Datos del negocio' });
    await u.type(screen.getByLabelText('Dirección'), ' 9');
    await u.click(screen.getByRole('button', { name: 'Guardar datos del negocio' }));
    await waitFor(() => expect(document.querySelectorAll('.aviso-error').length).toBeGreaterThan(0));
    await u.click(screen.getByRole('button', { name: 'Salir' }));
    await u.click(await screen.findByRole('button', { name: 'Salir sin guardar' }));
    await screen.findByRole('button', { name: 'Entrar' });
    await waitFor(() => expect(document.querySelectorAll('.aviso-error').length).toBe(0));
    await entrar('sup@ejemplo.test', 'clave-sup-1');
    await screen.findByRole('navigation', { name: 'Menú principal' });
    expect(document.querySelectorAll('.aviso-error').length).toBe(0);
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
    expect(items()).toEqual(['Venta', 'Recibos', 'Inventario', 'Mermas', 'Aprobaciones', 'Supervisión', 'Catálogo y sitio', 'Usuarios', 'Tipo de cambio', 'Configuración']);
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
    expect(items()).toEqual(['Recibos', 'Inventario', 'Mermas', 'Catálogo y sitio', 'Usuarios', 'Tipo de cambio', 'Configuración']);
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
    expect(items()).toEqual(['Usuarios', 'Tipo de cambio', 'Configuración']);
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

describe('sesión vencida (G-15)', () => {
  it('un callable que responde «unauthenticated» cierra la sesión, explica el motivo y, al ingresar, vuelve a la misma ruta', async () => {
    const sesion = new SesionDoble();
    const entorno = crearEntorno('adm');
    let vencer = false;
    const base = entorno.api;
    const api = {
      llamar: (nombre: string, ...resto: unknown[]) => (vencer && nombre !== 'modulosActivos' ? Promise.reject(new ErrorApi('unauthenticated', 'x')) : (base.llamar as (...a: unknown[]) => Promise<unknown>)(nombre, ...resto)),
    } as unknown as typeof entorno.api;
    render(h(App, { sesion, api, almacen: entorno.almacen }));
    await entrar('adm@ejemplo.test', 'clave-adm-1');
    await screen.findByRole('navigation', { name: 'Menú principal' });
    window.location.hash = '#/usuarios';
    await screen.findByText(/Personas con acceso/);
    vencer = true;
    sesion.renovable = false;
    window.location.hash = '#/configuracion';
    expect(await screen.findByText(/Su sesión venció\. Ingrese de nuevo para seguir donde estaba/)).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Menú principal' })).toBeNull();
    vencer = false;
    sesion.renovable = true;
    await entrar('adm@ejemplo.test', 'clave-adm-1');
    await screen.findByRole('navigation', { name: 'Menú principal' });
    expect(window.location.hash).toBe('#/configuracion');
    expect(screen.queryByText(/Su sesión venció/)).toBeNull();
  });
});

describe('cabecera plegable, título y foco', () => {
  it('el botón Menú declara aria-expanded y aria-controls; abre, Esc cierra y devuelve el foco', async () => {
    montar();
    await entrar('adm@ejemplo.test', 'clave-adm-1');
    await screen.findByRole('navigation', { name: 'Menú principal' });
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Venta'));
    const u = userEvent.setup();
    const boton = screen.getByRole('button', { name: 'Menú' });
    expect(boton.getAttribute('aria-expanded')).toBe('false');
    const panel = document.getElementById(boton.getAttribute('aria-controls') ?? '');
    expect(panel).not.toBeNull();
    expect(panel?.classList.contains('abierto')).toBe(false);
    await u.click(boton);
    expect(boton.getAttribute('aria-expanded')).toBe('true');
    expect(panel?.classList.contains('abierto')).toBe(true);
    expect(document.activeElement).toBe(within(panel as HTMLElement).getAllByRole('link')[0]);
    await u.keyboard('{Escape}');
    expect(boton.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(boton);
  });
  describe('menú de hamburguesa', () => {
    const abrir = async (): Promise<{ u: ReturnType<typeof userEvent.setup>; boton: HTMLElement; panel: HTMLElement }> => {
      montar();
      await entrar('adm@ejemplo.test', 'clave-adm-1');
      await screen.findByRole('navigation', { name: 'Menú principal' });
      await waitFor(() => expect(document.activeElement?.textContent).toBe('Venta'));
      const u = userEvent.setup();
      const boton = screen.getByRole('button', { name: 'Menú' });
      const panel = document.getElementById(boton.getAttribute('aria-controls') ?? '') as HTMLElement;
      await u.click(boton);
      expect(boton.getAttribute('aria-expanded')).toBe('true');
      return { u, boton, panel };
    };
    it('el botón es el primero de la cabecera, dibuja tres barras y su nombre accesible es «Menú»', async () => {
      montar();
      await entrar('adm@ejemplo.test', 'clave-adm-1');
      const boton = await screen.findByRole('button', { name: 'Menú' });
      expect(document.querySelector('.cabecera-interior')?.firstElementChild).toBe(boton);
      expect(boton.querySelectorAll('.hamburguesa > span')).toHaveLength(3);
      expect(boton.textContent).toBe('');
      expect(document.querySelectorAll('nav[aria-label="Menú principal"]')).toHaveLength(1);
    });
    it('el mismo botón lo cierra y el foco vuelve al botón', async () => {
      const { u, boton, panel } = await abrir();
      expect(panel.classList.contains('abierto')).toBe(true);
      expect(document.activeElement).toBe(within(panel).getAllByRole('link')[0]);
      await u.click(boton);
      expect(boton.getAttribute('aria-expanded')).toBe('false');
      expect(panel.classList.contains('abierto')).toBe(false);
      expect(document.activeElement).toBe(boton);
    });
    it('Escape lo cierra y el foco vuelve al botón', async () => {
      const { u, boton } = await abrir();
      await u.keyboard('{Escape}');
      expect(boton.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(boton);
    });
    it('tocar fuera lo cierra; tocar dentro del panel no', async () => {
      const { u, boton, panel } = await abrir();
      await u.click(panel);
      expect(boton.getAttribute('aria-expanded')).toBe('true');
      await u.click(document.getElementById('contenido') as HTMLElement);
      expect(boton.getAttribute('aria-expanded')).toBe('false');
    });
    it('elegir un enlace navega y lo cierra', async () => {
      const { u, boton } = await abrir();
      await u.click(screen.getByRole('link', { name: 'Mermas' }));
      await waitFor(() => expect(window.location.hash).toBe('#/mermas'));
      await waitFor(() => expect(boton.getAttribute('aria-expanded')).toBe('false'));
    });
    it('al pasar a pantalla ancha con el menú abierto se cierra y se sueltan los oyentes', async () => {
      const oyentes = new Set<() => void>();
      const mq = { matches: false, addEventListener: (_: string, f: () => void) => oyentes.add(f), removeEventListener: (_: string, f: () => void) => oyentes.delete(f) };
      window.matchMedia = vi.fn(() => mq) as never;
      const { boton } = await abrir();
      expect(oyentes.size).toBe(1);
      mq.matches = true;
      act(() => oyentes.forEach((f) => f()));
      await waitFor(() => expect(boton.getAttribute('aria-expanded')).toBe('false'));
      expect(oyentes.size).toBe(0);
      delete (window as { matchMedia?: unknown }).matchMedia;
    });
    it('al abrirlo no cambia la ruta ni duplica el menú', async () => {
      const { panel } = await abrir();
      const antes = window.location.hash;
      expect(panel.querySelectorAll('nav')).toHaveLength(1);
      expect(window.location.hash).toBe(antes);
    });
  });
  it('la redirección inicial no pisa una navegación del usuario ni cierra el menú abierto', async () => {
    montar();
    await entrar('adm@ejemplo.test', 'clave-adm-1');
    // Sin esperar a que se resuelva la redirección a la pantalla por omisión: el usuario ya navega.
    const boton = await screen.findByRole('button', { name: 'Menú' });
    window.location.hash = '#/mermas';
    await new Promise((r) => setTimeout(r, 150));
    expect(window.location.hash).toBe('#/mermas');
    const u = userEvent.setup();
    await u.click(boton);
    await new Promise((r) => setTimeout(r, 150));
    expect(boton.getAttribute('aria-expanded')).toBe('true');
  });
  it('con la ruta vacía, abrir el menú antes de la redirección inicial no lo cierra', async () => {
    montar();
    await entrar('adm@ejemplo.test', 'clave-adm-1');
    const boton = await screen.findByRole('button', { name: 'Menú' });
    const u = userEvent.setup();
    await u.click(boton);
    await waitFor(() => expect(window.location.hash).toBe('#/venta/terminal'));
    await new Promise((r) => setTimeout(r, 100));
    expect(boton.getAttribute('aria-expanded')).toBe('true');
  });
  it('navegar cierra el menú', async () => {
    montar();
    await entrar('adm@ejemplo.test', 'clave-adm-1');
    await screen.findByRole('navigation', { name: 'Menú principal' });
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Venta'));
    const u = userEvent.setup();
    const boton = screen.getByRole('button', { name: 'Menú' });
    await u.click(boton);
    await u.click(screen.getByRole('link', { name: 'Mermas' }));
    await waitFor(() => expect(boton.getAttribute('aria-expanded')).toBe('false'));
  });
  it('el título del documento sigue a la pantalla y el foco pasa a su encabezado principal', async () => {
    montar();
    await entrar('adm@ejemplo.test', 'clave-adm-1');
    await screen.findByRole('navigation', { name: 'Menú principal' });
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Venta'));
    window.location.hash = '#/mermas';
    await waitFor(() => expect(document.title).toBe('Mermas · Panel de gestión'));
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Mermas'));
    expect(document.activeElement?.tagName).toBe('H1');
    window.location.hash = '#/usuarios';
    await waitFor(() => expect(document.title).toBe('Usuarios · Panel de gestión'));
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Usuarios'));
  });
});
