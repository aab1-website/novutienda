// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorApi } from '../../api/errores.js';
import { crearEntorno, type Entorno } from '../../ayuda-pruebas.js';
import { ProveedorGuardia } from '../../ui/guardia.js';
import { PantallaSecciones } from './catalogo-secciones.js';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const ver = (e: Entorno): void => void render(e.envolver(h(ProveedorGuardia, null, h(PantallaSecciones, null))));
type U = ReturnType<typeof userEvent.setup>;
const nueva = async (u: U): Promise<void> => {
  await u.click(await screen.findByRole('button', { name: 'Nueva sección' }));
  await u.type(await screen.findByLabelText(/Título \(texto del menú\)/), 'Cómo comprar');
};
const bloqueTexto = async (u: U, titulo: string, parrafo: string): Promise<void> => {
  await u.click(screen.getByRole('button', { name: '+ Texto' }));
  const titulos = screen.getAllByLabelText('Título del bloque');
  const areas = screen.getAllByLabelText(/Párrafos/);
  await u.type(titulos[titulos.length - 1] as HTMLElement, titulo);
  await u.type(areas[areas.length - 1] as HTMLElement, parrafo);
};

describe('secciones: bloques con identificador estable', () => {
  it('al quitar el bloque 1, el bloque 2 conserva su propio texto', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    await nueva(u);
    await bloqueTexto(u, 'Primero', 'Texto del primero');
    await bloqueTexto(u, 'Segundo', 'Texto del segundo');
    await u.click(screen.getAllByRole('button', { name: 'Quitar bloque' })[0] as HTMLElement);
    await u.click(await screen.findByRole('button', { name: 'Sí, quitar' }));
    expect(screen.getAllByLabelText('Título del bloque')).toHaveLength(1);
    expect((screen.getByLabelText('Título del bloque') as HTMLInputElement).value).toBe('Segundo');
    expect((screen.getByLabelText(/Párrafos/) as HTMLTextAreaElement).value).toBe('Texto del segundo');
    await u.click(screen.getByRole('button', { name: 'Guardar sección' }));
    await waitFor(async () => expect((await e.api.llamar('listarSecciones', {}))[0]?.bloques).toEqual([{ tipo: 'texto', titulo: 'Segundo', parrafos: ['Texto del segundo'] }]));
  });

  it('quitar un bloque pide confirmar y «Cancelar» en la pregunta lo deja', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    await nueva(u);
    await bloqueTexto(u, 'Único', 'Texto');
    await u.click(screen.getByRole('button', { name: 'Quitar bloque' }));
    const pregunta = await screen.findByRole('dialog', { name: /¿Quitar el bloque 1/ });
    await u.click(within(pregunta).getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByLabelText('Título del bloque')).toBeTruthy();
  });

  it('el identificador local no viaja al servidor', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    await nueva(u);
    await bloqueTexto(u, 'Pasos', 'Uno');
    await u.click(screen.getByRole('button', { name: '+ Enlaces' }));
    await u.type(screen.getByLabelText(/Enlaces \(uno por línea/), 'Contacto | /contacto');
    await u.click(screen.getByRole('button', { name: 'Guardar sección' }));
    await waitFor(async () => expect((await e.api.llamar('listarSecciones', {})).length).toBe(1));
    const s = (await e.api.llamar('listarSecciones', {}))[0];
    expect(JSON.stringify(s)).not.toMatch(/"uid"/);
    expect(s?.bloques[1]).toEqual({ tipo: 'enlaces', items: [{ texto: 'Contacto', url: '/contacto' }] });
  });
});

describe('secciones: motivos, guardia y cancelar', () => {
  it('«Guardar sección» dice por qué no guarda y no envía nada', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Nueva sección' }));
    const guardar = screen.getByRole('button', { name: 'Guardar sección' });
    expect(screen.getByText('Escriba el título de la sección.')).toBeTruthy();
    await u.type(screen.getByLabelText(/Título \(texto del menú\)/), 'Garantía');
    expect(screen.getByText('Agregue al menos un bloque a la sección.')).toBeTruthy();
    await u.click(screen.getByRole('button', { name: '+ Imagen' }));
    expect(screen.getByText('Elija la foto del bloque 1.')).toBeTruthy();
    await u.click(guardar);
    expect(e.api.llamadas.some((l) => l.nombre === 'guardarSeccion')).toBe(false);
  });

  it('con cambios, «Cancelar» pregunta; sin cambios, vuelve a la lista directo', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Nueva sección' }));
    await u.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByRole('button', { name: 'Nueva sección' })).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Nueva sección' }));
    await u.type(await screen.findByLabelText(/Título \(texto del menú\)/), 'Algo');
    await u.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByRole('dialog', { name: '¿Salir sin guardar?' })).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Seguir editando' }));
    expect((screen.getByLabelText(/Título \(texto del menú\)/) as HTMLInputElement).value).toBe('Algo');
    await u.click(screen.getByRole('button', { name: 'Cancelar' }));
    await u.click(await screen.findByRole('button', { name: 'Salir sin guardar' }));
    expect(await screen.findByRole('button', { name: 'Nueva sección' })).toBeTruthy();
  });

  it('con cambios sin guardar, cerrar la pestaña pregunta', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Nueva sección' }));
    const cierre = (): boolean => !window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
    expect(cierre()).toBe(false);
    await u.type(screen.getByLabelText(/Título \(texto del menú\)/), 'Algo');
    await waitFor(() => expect(cierre()).toBe(true));
  });

  it('si el servidor rechaza, el error se ve y lo escrito se conserva', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    await nueva(u);
    await bloqueTexto(u, 'Pasos', 'Uno');
    const llamar = e.api.llamar.bind(e.api) as (n: string, x: unknown) => Promise<unknown>;
    vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, x: unknown) => (n === 'guardarSeccion' ? Promise.reject(new ErrorApi('unavailable', 'sin conexión')) : llamar(n, x))) as never);
    await u.click(screen.getByRole('button', { name: 'Guardar sección' }));
    await waitFor(() => expect(document.querySelector('[role="alert"], .alerta')).not.toBeNull());
    expect((screen.getByLabelText(/Párrafos/) as HTMLTextAreaElement).value).toBe('Uno');
  });
});

const BASE_MEDIOS = 'https://medios.ejemplo.test';
/** Hace que `listarMedios` entregue versiones WebP, como el servidor tras procesar la foto. */
const conVersiones = (e: Entorno): void => {
  const original = e.api.llamar.bind(e.api) as (n: string, d: unknown) => Promise<unknown>;
  vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, d: unknown) =>
    original(n, d).then((r) => (n === 'listarMedios' ? (r as { id: string }[]).map((m) => ({ ...m, versiones: [{ clase: 'imagen', lado: 960, formato: 'webp', ruta: `t/${m.id}-960.webp`, bytes: 9 }, { clase: 'imagen', lado: 480, formato: 'webp', ruta: `t/${m.id}-480.webp`, bytes: 5 }] })) : r))) as never);
};

describe('secciones: miniaturas en el selector de foto', () => {
  const subir = async (e: Entorno): Promise<string> => {
    const r = await e.api.llamar('reservarSubida', { subidaId: '11111111-1111-4111-8111-111111111111', productoId: 'tv-55', tipo: 'foto', bytes: 10 });
    await e.api.llamar('finalizarSubida', { subidaId: r.subidaId });
    return r.subidaId;
  };
  const elegirProducto = async (u: U): Promise<void> => {
    await u.click(await screen.findByRole('button', { name: 'Nueva sección' }));
    await u.click(screen.getByRole('button', { name: '+ Imagen' }));
    await u.type(await screen.findByRole('combobox', { name: /producto/ }), 'Televisor');
    await u.click(await screen.findByRole('option', { name: /Televisor/ }));
  };

  it('con base de medios muestra la miniatura elegible con teclado', async () => {
    vi.stubEnv('VITE_MEDIOS_BASE_URL', BASE_MEDIOS);
    const e = crearEntorno('adm');
    const id = await subir(e);
    conVersiones(e);
    ver(e);
    const u = userEvent.setup();
    await elegirProducto(u);
    const radio = await screen.findByRole('radio', { name: /^Foto 1/ });
    const img = radio.parentElement?.querySelector('img');
    expect(img?.getAttribute('src')).toBe(`${BASE_MEDIOS}/t/${id}-480.webp`);
    expect(img?.getAttribute('loading')).toBe('lazy');
    expect(img?.getAttribute('decoding')).toBe('async');
    expect(img?.getAttribute('referrerpolicy')).toBe('no-referrer');
    radio.focus();
    await u.keyboard(' ');
    expect((radio as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByText('Elija la foto del bloque 1.')).toBeNull();
  });

  it('sin base muestra el texto de respaldo y no una imagen rota', async () => {
    vi.stubEnv('VITE_MEDIOS_BASE_URL', '');
    const e = crearEntorno('adm');
    await subir(e);
    conVersiones(e);
    ver(e);
    const u = userEvent.setup();
    await elegirProducto(u);
    const radio = await screen.findByRole('radio', { name: /^Foto 1/ });
    expect(radio.parentElement?.querySelector('img')).toBeNull();
    expect(radio.parentElement?.querySelector('[data-respaldo]')?.textContent).toMatch(/Foto 111111.*n\.º 1.*1200 × 800/);
  });

  it('si la imagen falla al cargar cae al respaldo', async () => {
    vi.stubEnv('VITE_MEDIOS_BASE_URL', BASE_MEDIOS);
    const e = crearEntorno('adm');
    await subir(e);
    conVersiones(e);
    ver(e);
    const u = userEvent.setup();
    await elegirProducto(u);
    const radio = await screen.findByRole('radio', { name: /^Foto 1/ });
    const img = radio.parentElement?.querySelector('img') as HTMLElement;
    fireEvent.error(img);
    await waitFor(() => expect(document.querySelector('.selector-miniaturas img')).toBeNull());
    expect(document.querySelector('.selector-miniaturas [data-respaldo]')).toBeTruthy();
  });

  it('«Sin foto» quita la foto elegida', async () => {
    vi.stubEnv('VITE_MEDIOS_BASE_URL', BASE_MEDIOS);
    const e = crearEntorno('adm');
    await subir(e);
    conVersiones(e);
    ver(e);
    const u = userEvent.setup();
    await elegirProducto(u);
    const radio = await screen.findByRole('radio', { name: /^Foto 1/ });
    await u.click(radio);
    expect(screen.queryByText('Elija la foto del bloque 1.')).toBeNull();
    await u.click(screen.getByRole('radio', { name: 'Sin foto' }));
    await waitFor(() => expect((screen.getByRole('radio', { name: 'Sin foto' }) as HTMLInputElement).checked).toBe(true));
    expect((screen.getByRole('radio', { name: /^Foto 1/ }) as HTMLInputElement).checked).toBe(false);
    // Sin foto elegida el sistema vuelve a explicar por qué no se puede guardar.
    expect(screen.getByRole('button', { name: 'Guardar sección' }).getAttribute('aria-disabled')).toBe('true');
  });
});
