// @vitest-environment jsdom
import { h, type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SelectorBuscable, type OpcionBuscable, type PropsSelectorBuscable } from './selector-buscable.js';

afterEach(cleanup);

const OPCIONES: OpcionBuscable[] = [
  { valor: 'a', texto: 'Árbol', detalle: 'Jardín' },
  { valor: 'b', texto: 'Botella' },
  { valor: 'c', texto: 'Cuaderno', detalle: 'Papelería' },
];

function montar(extra: { opciones?: OpcionBuscable[]; valor?: string | null; maxResultados?: number; requerido?: boolean; opcionVacia?: string; ayuda?: string; error?: string } = {}) {
  const onCambio = vi.fn();
  function Envoltorio(): VNode {
    const [v, setV] = useState<string | null>(extra.valor ?? null);
    const props: PropsSelectorBuscable = { maxResultados: extra.maxResultados, requerido: extra.requerido, opcionVacia: extra.opcionVacia, ayuda: extra.ayuda, error: extra.error, etiqueta: 'Producto', opciones: extra.opciones ?? OPCIONES, valor: v, onCambio: (x: string) => { setV(x); onCambio(x); } };
    return h(SelectorBuscable, props) as VNode;
  }
  render(h(Envoltorio, {}));
  return { onCambio, entrada: screen.getByRole('combobox', { name: /Producto/ }) as HTMLInputElement };
}

describe('SelectorBuscable', () => {
  it('nace sin valor y cerrado, con los atributos del patrón combobox', () => {
    const { entrada } = montar();
    expect(entrada.value).toBe('');
    expect(entrada.getAttribute('aria-expanded')).toBe('false');
    expect(entrada.getAttribute('aria-autocomplete')).toBe('list');
    expect(entrada.getAttribute('aria-controls')).toBeTruthy();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('con valor muestra su texto', () => {
    expect(montar({ valor: 'b' }).entrada.value).toBe('Botella');
  });

  it('↓ abre la lista, mueve la opción activa y Enter elige', async () => {
    const u = userEvent.setup();
    const { entrada, onCambio } = montar();
    await u.click(entrada);
    await u.keyboard('{ArrowDown}');
    const lista = screen.getByRole('listbox');
    expect(entrada.getAttribute('aria-expanded')).toBe('true');
    expect(entrada.getAttribute('aria-controls')).toBe(lista.id);
    const opciones = screen.getAllByRole('option');
    expect(opciones).toHaveLength(3);
    expect(entrada.getAttribute('aria-activedescendant')).toBe(opciones[0]?.id);
    expect(opciones[0]?.getAttribute('aria-selected')).toBe('false');
    await u.keyboard('{ArrowDown}');
    expect(entrada.getAttribute('aria-activedescendant')).toBe(opciones[1]?.id);
    await u.keyboard('{Enter}');
    expect(onCambio).toHaveBeenCalledWith('b');
    expect(entrada.value).toBe('Botella');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Inicio, Fin y ↑ recorren la lista sin salirse', async () => {
    const u = userEvent.setup();
    const { entrada } = montar();
    await u.click(entrada);
    await u.keyboard('{ArrowDown}{End}');
    const opciones = screen.getAllByRole('option');
    expect(entrada.getAttribute('aria-activedescendant')).toBe(opciones[2]?.id);
    await u.keyboard('{ArrowDown}');
    expect(entrada.getAttribute('aria-activedescendant')).toBe(opciones[2]?.id);
    await u.keyboard('{ArrowUp}');
    expect(entrada.getAttribute('aria-activedescendant')).toBe(opciones[1]?.id);
    await u.keyboard('{Home}');
    expect(entrada.getAttribute('aria-activedescendant')).toBe(opciones[0]?.id);
    await u.keyboard('{ArrowUp}');
    expect(entrada.getAttribute('aria-activedescendant')).toBe(opciones[0]?.id);
  });

  it('escribir acota sin tildes ni mayúsculas, también por detalle', async () => {
    const u = userEvent.setup();
    const { entrada } = montar();
    await u.type(entrada, 'ARBOL');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['ÁrbolJardín']);
    await u.clear(entrada);
    await u.type(entrada, 'papel');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await u.clear(entrada);
    await u.type(entrada, 'zzz');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(entrada.getAttribute('aria-controls')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Sin resultados');
  });

  it('Esc cierra la lista y detiene la propagación; con la lista cerrada no la detiene', async () => {
    const u = userEvent.setup();
    const { entrada } = montar();
    const alPadre = vi.fn();
    document.body.addEventListener('keydown', alPadre);
    await u.click(entrada);
    await u.keyboard('{ArrowDown}');
    await u.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(alPadre).not.toHaveBeenCalledWith(expect.objectContaining({ key: 'Escape' }));
    await u.keyboard('{Escape}');
    expect(alPadre).toHaveBeenCalledWith(expect.objectContaining({ key: 'Escape' }));
    document.body.removeEventListener('keydown', alPadre);
  });

  it('un clic elige la opción y al perder el foco sin elegir se restaura el valor', async () => {
    const u = userEvent.setup();
    const { entrada, onCambio } = montar({ valor: 'a' });
    await u.click(entrada);
    await u.keyboard('{ArrowDown}');
    await u.click(screen.getByRole('option', { name: /Cuaderno/ }));
    expect(onCambio).toHaveBeenCalledWith('c');
    await u.type(entrada, 'xx');
    fireEvent.blur(entrada);
    expect(entrada.value).toBe('Cuaderno');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('con más de maxResultados muestra solo ese tope y «Hay N más; escriba para acotar»', async () => {
    const u = userEvent.setup();
    const muchas = Array.from({ length: 8 }, (_, i) => ({ valor: `v${i}`, texto: `Cosa ${i}` }));
    const { entrada } = montar({ opciones: muchas, maxResultados: 5 });
    await u.click(entrada);
    await u.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')).toHaveLength(5);
    expect(screen.getByRole('status').textContent).toBe('Hay 3 más; escriba para acotar');
    await u.type(entrada, 'cosa 7');
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('el estado existe siempre en el DOM, aun con la lista cerrada', () => {
    montar();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('al abrir, la opción activa es la ya elegida y queda marcada con aria-selected', async () => {
    const u = userEvent.setup();
    const { entrada } = montar({ valor: 'b' });
    await u.click(entrada);
    await u.keyboard('{ArrowDown}');
    const opciones = screen.getAllByRole('option');
    expect(entrada.getAttribute('aria-activedescendant')).toBe(opciones[1]?.id);
    expect(opciones.map((o) => o.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
  });

  it('con opcionVacia se puede volver a «sin valor»; si es obligatorio no aparece', async () => {
    const u = userEvent.setup();
    const { entrada, onCambio } = montar({ valor: 'b', opcionVacia: 'Sin producto' });
    await u.click(entrada);
    await u.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[0]?.textContent).toBe('Sin producto');
    await u.click(screen.getByRole('option', { name: 'Sin producto' }));
    expect(onCambio).toHaveBeenCalledWith('');
    cleanup();
    const obligatorio = montar({ requerido: true, opcionVacia: 'Sin producto' });
    await u.click(obligatorio.entrada);
    await u.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('requerido, ayuda y error quedan enlazados al campo', () => {
    const { entrada } = montar({ requerido: true, ayuda: 'Elija uno', error: 'Falta el producto' });
    expect(entrada.getAttribute('aria-required')).toBe('true');
    expect(entrada.getAttribute('aria-invalid')).toBe('true');
    const descrito = (entrada.getAttribute('aria-describedby') ?? '').split(' ').map((i) => document.getElementById(i)?.textContent);
    expect(descrito).toEqual(['Elija uno', 'Falta el producto']);
    expect(screen.getByText('(obligatorio)', { exact: false })).toBeTruthy();
  });
});
