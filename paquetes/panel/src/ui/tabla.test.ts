// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, render, screen, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Tabla, type PropsTabla } from './tabla.js';

afterEach(cleanup);

interface Fila { id: string; nombre: string; rol: string; n: number }
const nombres = ['José', 'Ana', 'Álvaro', 'Beatriz', 'Carlos'];
function filas(cuantas: number): Fila[] {
  return Array.from({ length: cuantas }, (_, i) => ({ id: `f${i}`, nombre: `${nombres[i % 5] as string} ${i}`, rol: i % 2 === 0 ? 'caj' : 'sup', n: i }));
}
function props(f: Fila[], extra: Partial<PropsTabla<Fila>> = {}): PropsTabla<Fila> {
  return {
    titulo: 'Personas',
    filas: f,
    clave: (x) => x.id,
    columnas: [
      { id: 'nombre', titulo: 'Nombre', valor: (x) => x.nombre, encabezadoFila: true, ordenable: true },
      { id: 'n', titulo: 'Número', valor: (x) => x.n, ordenable: true },
      { id: 'rol', titulo: 'Rol', valor: (x) => x.rol },
    ],
    ...extra,
  };
}
const montar = (p: PropsTabla<Fila>): void => void render(h(Tabla<Fila>, p));
const nombresVisibles = (): string[] => screen.getAllByRole('rowheader').map((c) => c.textContent ?? '');

describe('Tabla', () => {
  it('tiene roles de tabla, contenedor enfocable con nombre y data-etiqueta en cada celda', () => {
    montar(props(filas(3)));
    const region = screen.getByRole('region', { name: 'Personas' });
    expect(region.getAttribute('tabindex')).toBeNull();
    expect(region.className).toContain('tabla-contenedor');
    expect(within(region).getByRole('table', { name: 'Personas' })).toBeTruthy();
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
    const celdas = screen.getAllByRole('cell');
    expect(celdas[0]?.getAttribute('data-etiqueta')).toBe('Número');
    expect(screen.getAllByRole('rowheader')[0]?.getAttribute('data-etiqueta')).toBe('Nombre');
  });

  it('el contenedor solo es enfocable cuando hay desplazamiento horizontal', () => {
    const ancho = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => 800 });
    try {
      montar(props(filas(2)));
      expect(screen.getByRole('region', { name: 'Personas' }).getAttribute('tabindex')).toBe('0');
    } finally {
      if (ancho) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', ancho);
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth');
    }
  });

  it('vista de tarjetas: cada celda lleva su etiqueta y las acciones quedan en la fila', () => {
    montar(props(filas(2), { vistaCelular: 'tarjetas', acciones: (f) => h('button', { type: 'button' }, `Editar ${f.nombre}`) }));
    expect(screen.getByRole('table').className).toContain('tabla-tarjetas');
    const fila = screen.getAllByRole('row')[1] as HTMLElement;
    expect(within(fila).getAllByRole('cell').map((c) => c.getAttribute('data-etiqueta'))).toEqual(['Número', 'Rol', null]);
    expect(within(fila).getByRole('rowheader').getAttribute('data-etiqueta')).toBe('Nombre');
    expect(within(fila).getByRole('button', { name: /Editar/ })).toBeTruthy();
  });

  it('con filas vacías sigue mostrando el aviso de lista cortada y «Cargar más»', () => {
    montar(props([], { vacio: { titulo: 'No hay personas' }, cortada: { mostradas: 0, mensaje: 'Lista cortada.' }, masDelServidor: { hay: true, cargar: vi.fn(), cargando: false } }));
    expect(screen.getByText('No hay personas')).toBeTruthy();
    expect(screen.getByText('Lista cortada.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cargar más' })).toBeTruthy();
  });

  it('más de cuatro columnas usan tarjetas en celular; con menos, desplazamiento; se puede forzar', () => {
    const seis = props(filas(1), { columnas: ['a', 'b', 'c', 'd', 'e'].map((c) => ({ id: c, titulo: c, valor: () => c })) });
    montar(seis);
    expect(screen.getByRole('table').className).toContain('tabla-tarjetas');
    cleanup();
    montar(props(filas(1)));
    expect(screen.getByRole('table').className).toContain('tabla-desplazar');
    cleanup();
    montar(props(filas(1), { vistaCelular: 'tarjetas' }));
    expect(screen.getByRole('table').className).toContain('tabla-tarjetas');
  });

  it('busca sin tildes ni mayúsculas y avisa el total en un estado polite', async () => {
    const u = userEvent.setup();
    montar(props(filas(10), { buscar: { etiqueta: 'Buscar persona', en: (x) => [x.nombre] } }));
    await u.type(screen.getByLabelText('Buscar persona'), 'ALVARO');
    expect(nombresVisibles()).toEqual(['Álvaro 2', 'Álvaro 7']);
    expect(screen.getByText('Se muestran 2 de 2').getAttribute('aria-live')).toBe('polite');
    await u.clear(screen.getByLabelText('Buscar persona'));
    await u.type(screen.getByLabelText('Buscar persona'), 'jose');
    expect(nombresVisibles()).toEqual(['José 0', 'José 5']);
    await u.clear(screen.getByLabelText('Buscar persona'));
    await u.type(screen.getByLabelText('Buscar persona'), 'zzz');
    expect(screen.getByText(/Sin resultados/)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('filtra con un select nativo', async () => {
    const u = userEvent.setup();
    montar(props(filas(6), { filtros: [{ id: 'rol', etiqueta: 'Rol', opciones: [{ valor: 'caj', texto: 'Vendedor' }, { valor: 'sup', texto: 'Supervisor' }], aplica: (x, v) => x.rol === v }] }));
    expect(screen.getAllByRole('rowheader')).toHaveLength(6);
    await u.selectOptions(screen.getByLabelText('Rol'), 'sup');
    expect(screen.getAllByRole('rowheader')).toHaveLength(3);
  });

  it('ordena con un botón dentro del encabezado y aria-sort: ascendente, descendente y sin orden', async () => {
    const u = userEvent.setup();
    montar(props(filas(3)));
    const th = screen.getByRole('columnheader', { name: /Número/ });
    expect(th.getAttribute('aria-sort')).toBe('none');
    expect(screen.getByRole('columnheader', { name: 'Rol' }).hasAttribute('aria-sort')).toBe(false);
    await u.click(within(th).getByRole('button'));
    expect(th.getAttribute('aria-sort')).toBe('ascending');
    await u.click(within(th).getByRole('button'));
    expect(th.getAttribute('aria-sort')).toBe('descending');
    expect(nombresVisibles()[0]).toBe('Álvaro 2');
    await u.click(within(th).getByRole('button'));
    expect(th.getAttribute('aria-sort')).toBe('none');
  });

  it('pagina con Anterior y Siguiente, el rango y vuelve a la página 1 al buscar', async () => {
    const u = userEvent.setup();
    montar(props(filas(60), { porPagina: 25, buscar: { etiqueta: 'Buscar', en: (x) => [x.nombre] } }));
    expect(screen.getByText('1–25 de 60')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Anterior' }) as HTMLButtonElement).disabled).toBe(true);
    await u.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByText('26–50 de 60')).toBeTruthy();
    expect(screen.getByText('Se muestran 25 de 60')).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByText('51–60 de 60')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Siguiente' }) as HTMLButtonElement).disabled).toBe(true);
    await u.type(screen.getByLabelText('Buscar'), 'ana');
    expect(screen.getByText('Se muestran 12 de 12')).toBeTruthy();
    expect(screen.getAllByRole('rowheader')).toHaveLength(12);
  });

  it('una sola página no muestra navegación', () => {
    montar(props(filas(5)));
    expect(screen.queryByRole('button', { name: 'Siguiente' })).toBeNull();
  });

  it('avisa que la lista está cortada y ofrece «Cargar más»', async () => {
    const u = userEvent.setup();
    const cargar = vi.fn();
    montar(props(filas(3), { cortada: { mostradas: 3, mensaje: 'Se muestran las primeras 3 filas.' }, masDelServidor: { hay: true, cargar, cargando: false } }));
    expect(screen.getByText('Se muestran las primeras 3 filas.')).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Cargar más' }));
    expect(cargar).toHaveBeenCalledTimes(1);
    cleanup();
    montar(props(filas(3), { masDelServidor: { hay: true, cargar, cargando: true } }));
    expect((screen.getByRole('button', { name: 'Cargando…' }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    montar(props(filas(3), { masDelServidor: { hay: false, cargar, cargando: false } }));
    expect(screen.queryByRole('button', { name: 'Cargar más' })).toBeNull();
  });

  it('sin filas muestra el vacío y no la tabla', () => {
    montar(props([], { vacio: { titulo: 'No hay personas' } }));
    expect(screen.getByText('No hay personas')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('acciones: última columna con encabezado solo para lectores', () => {
    montar(props(filas(2), { acciones: (x) => h('button', { type: 'button' }, `Quitar ${x.id}`) }));
    expect(screen.getByRole('columnheader', { name: 'Acciones' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Quitar f1' })).toBeTruthy();
  });
});
