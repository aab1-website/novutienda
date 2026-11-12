// @vitest-environment jsdom
import { h, type JSX } from 'preact';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorApi } from '../api/errores.js';
import { useAccion } from './hooks.js';
import { MS_AVISO, ProveedorAvisos, useAvisos, type Avisos } from './avisos.js';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function montar(): { avisos: () => Avisos } {
  let api: Avisos | undefined;
  function Toma(): JSX.Element {
    api = useAvisos();
    return h('span', null, 'pantalla');
  }
  render(h(ProveedorAvisos, null, h(Toma, null)));
  return { avisos: () => api as Avisos };
}

const region = (tipo: 'estado' | 'error'): HTMLElement => document.querySelector(`[data-region="avisos-${tipo}"]`) as HTMLElement;
const avanzar = (ms: number): void => void act(() => void vi.advanceTimersByTime(ms));

describe('ProveedorAvisos', () => {
  it('puntero y foco pausan por separado: salir con el puntero no reanuda si el foco sigue dentro', () => {
    const { avisos } = montar();
    act(() => void avisos().ok('Guardado'));
    const caja = screen.getByText('Guardado').parentElement as HTMLElement;
    fireEvent.mouseEnter(caja);
    fireEvent.focusIn(caja);
    fireEvent.mouseLeave(caja);
    avanzar(20_000);
    expect(screen.getByText('Guardado')).toBeTruthy();
    fireEvent.focusOut(caja);
    avanzar(MS_AVISO);
    expect(screen.queryByText('Guardado')).toBeNull();
  });

  it('«Cerrar» devuelve el foco a quien lo tenía antes de entrar al aviso, o al título', () => {
    const { avisos } = montar();
    const anterior = document.createElement('button');
    document.body.append(anterior);
    act(() => void avisos().error('Falló'));
    anterior.focus();
    const cerrar = screen.getByRole('button', { name: 'Cerrar' });
    cerrar.focus();
    fireEvent.focusIn(cerrar, { relatedTarget: anterior });
    fireEvent.click(cerrar);
    act(() => void vi.advanceTimersByTime(5));
    expect(document.activeElement).toBe(anterior);
    anterior.remove();
    // Sin origen conocido, al título de la pantalla.
    const titulo = document.createElement('h1');
    document.body.append(titulo);
    act(() => void avisos().error('Otro'));
    const otro = screen.getByRole('button', { name: 'Cerrar' });
    otro.focus();
    fireEvent.click(otro);
    act(() => void vi.advanceTimersByTime(5));
    expect(document.activeElement).toBe(titulo);
    titulo.remove();
  });

  it('las dos regiones vivas existen desde el montaje, vacías, y fuera del fondo inerte', () => {
    montar();
    expect(region('estado').getAttribute('aria-live')).toBe('polite');
    expect(region('error').getAttribute('aria-live')).toBe('assertive');
    expect(region('estado').children).toHaveLength(0);
    expect(region('error').children).toHaveLength(0);
    expect(region('estado').closest('[data-capa-viva]')).not.toBeNull();
  });

  it('éxito e info van a la región de estado y se van a los 6 s; los errores van a la de errores', () => {
    const { avisos } = montar();
    act(() => {
      avisos().ok('Guardado');
      avisos().info('Dato');
      avisos().error('Falló');
    });
    expect(region('estado').textContent).toContain('Guardado');
    expect(region('estado').textContent).toContain('Dato');
    expect(region('error').textContent).toContain('Falló');
    avanzar(MS_AVISO - 1);
    expect(screen.getByText('Guardado')).toBeTruthy();
    avanzar(1);
    expect(screen.queryByText('Guardado')).toBeNull();
    expect(screen.queryByText('Dato')).toBeNull();
    // El error persiste.
    avanzar(60_000);
    expect(screen.getByText('Falló')).toBeTruthy();
  });

  it('la pausa bajo puntero o foco detiene la cuenta y al soltar vuelve a contar', () => {
    const { avisos } = montar();
    act(() => void avisos().ok('Guardado'));
    const caja = screen.getByText('Guardado').parentElement as HTMLElement;
    fireEvent.mouseEnter(caja);
    avanzar(20_000);
    expect(screen.getByText('Guardado')).toBeTruthy();
    fireEvent.mouseLeave(caja);
    avanzar(MS_AVISO);
    expect(screen.queryByText('Guardado')).toBeNull();
    act(() => void avisos().ok('Otro'));
    const otra = screen.getByText('Otro').parentElement as HTMLElement;
    fireEvent.focusIn(otra);
    avanzar(20_000);
    expect(screen.getByText('Otro')).toBeTruthy();
    fireEvent.focusOut(otra);
    avanzar(MS_AVISO);
    expect(screen.queryByText('Otro')).toBeNull();
  });

  it('el botón «Cerrar» quita el aviso y «Reintentar» llama y cierra', () => {
    const { avisos } = montar();
    const otra = vi.fn();
    act(() => {
      avisos().error('Uno');
      avisos().error('Dos', { reintentar: otra });
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Cerrar' })[0] as HTMLElement);
    expect(screen.queryByText('Uno')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(otra).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Dos')).toBeNull();
  });

  it('muestra como máximo 3: descarta primero éxito e info y, si todos son errores, el más viejo', () => {
    const { avisos } = montar();
    act(() => {
      avisos().error('E1');
      avisos().ok('O1');
      avisos().error('E2');
      avisos().error('E3');
    });
    expect(screen.queryByText('O1')).toBeNull();
    expect(['E1', 'E2', 'E3'].every((t) => screen.queryByText(t) !== null)).toBe(true);
    act(() => void avisos().error('E4'));
    expect(screen.queryByText('E1')).toBeNull();
    expect(screen.getByText('E4')).toBeTruthy();
    expect(document.querySelectorAll('.aviso')).toHaveLength(3);
  });

  it('el mismo aviso repetido no se apila', () => {
    const { avisos } = montar();
    act(() => {
      avisos().error('Igual');
      avisos().error('Igual');
    });
    expect(screen.getAllByText('Igual')).toHaveLength(1);
  });

  it('cerrar(id) quita el aviso', () => {
    const { avisos } = montar();
    let id = 0;
    act(() => void (id = avisos().ok('Hola')));
    act(() => avisos().cerrar(id));
    expect(screen.queryByText('Hola')).toBeNull();
  });
});

describe('useAccion con avisos', () => {
  function Caso(p: { fn: () => Promise<unknown>; modo?: 'local' | 'aviso' | 'ambos'; exito?: string | ((r: never) => string) }): JSX.Element {
    const a = useAccion();
    return h(
      'div',
      null,
      h('button', { type: 'button', onClick: () => void a.ejecutar(p.fn, { ...(p.modo === undefined ? {} : { error: p.modo }), ...(p.exito === undefined ? {} : { exito: p.exito as string }) }) }, 'Ir'),
      h('button', { type: 'button', onClick: () => void a.ejecutar(p.fn) }, 'Ir sin opciones'),
      a.error !== null && h('p', { 'data-prueba': 'local' }, a.error),
    );
  }
  const fallar = (): Promise<never> => Promise.reject(new ErrorApi('permission-denied', 'Falló esto'));

  async function pulsar(nombre: string): Promise<void> {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: nombre }));
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  it('por omisión no hay aviso: el error queda local, como hoy', async () => {
    render(h(ProveedorAvisos, null, h(Caso, { fn: fallar })));
    await pulsar('Ir sin opciones');
    expect(document.querySelector('[data-prueba="local"]')).not.toBeNull();
    expect(document.querySelectorAll('.aviso')).toHaveLength(0);
  });

  it('exito (texto o función) avisa solo si salió bien', async () => {
    render(h(ProveedorAvisos, null, h(Caso, { fn: () => Promise.resolve(3), exito: (r: never) => `Van ${String(r)}` })));
    await pulsar('Ir');
    expect(region('estado').textContent).toContain('Van 3');
    cleanup();
    render(h(ProveedorAvisos, null, h(Caso, { fn: fallar, exito: 'Listo' })));
    await pulsar('Ir');
    expect(screen.queryByText('Listo')).toBeNull();
  });

  it("error 'aviso' lo deja solo como aviso; 'ambos' también local; 'local' solo local", async () => {
    render(h(ProveedorAvisos, null, h(Caso, { fn: fallar, modo: 'aviso' })));
    await pulsar('Ir');
    expect(region('error').textContent).toContain('Falló esto');
    expect(document.querySelector('[data-prueba="local"]')).toBeNull();
    cleanup();
    render(h(ProveedorAvisos, null, h(Caso, { fn: fallar, modo: 'ambos' })));
    await pulsar('Ir');
    // Con «ambos» el aviso se ve pero no se anuncia dos veces: no cae en la región asertiva.
    expect(region('error').children).toHaveLength(0);
    expect(document.querySelector('[data-region="avisos-error-visual"]')?.textContent).toContain('Falló esto');
    expect(document.querySelector('[data-prueba="local"]')).not.toBeNull();
    cleanup();
    render(h(ProveedorAvisos, null, h(Caso, { fn: fallar, modo: 'local' })));
    await pulsar('Ir');
    expect(region('error').children).toHaveLength(0);
    expect(document.querySelector('[data-prueba="local"]')).not.toBeNull();
  });
});
