// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, render, screen, waitFor, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorApi } from '../../api/errores.js';
import { crearEntorno, type Entorno } from '../../ayuda-pruebas.js';
import { ProveedorGuardia } from '../../ui/guardia.js';
import { PantallaSecciones } from './catalogo-secciones.js';

afterEach(() => {
  cleanup();
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
