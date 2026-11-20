// @vitest-environment jsdom
import { h } from 'preact';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { crearEntorno, uuid, type Entorno } from '../../ayuda-pruebas.js';
import { usePaginado } from './paginado.js';
import { PantallaVenta } from './venta.js';

afterEach(cleanup);

const ver = (e: Entorno, sub: string): void => void render(e.envolver(h(PantallaVenta, { sub })));

async function vender(e: Entorno, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await e.api.llamar('confirmarVenta', {
      requestId: uuid(), carrito: { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'cable-hdmi', cantidad: 1 }] }, pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 5568 }],
    });
  }
}
const abrir = (e: Entorno): Promise<unknown> => e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 10000 } });

describe('«Mi reporte»', () => {
  it('muestra el turno en vivo con ventas, total y lo cobrado por medio', async () => {
    const e = crearEntorno('caj');
    await abrir(e);
    await vender(e, 2);
    ver(e, 'reporte');
    await screen.findByRole('heading', { name: 'Turno actual' });
    const bob = await screen.findByRole('region', { name: 'Resumen en Bolivianos' });
    expect(within(bob).getByText('Ventas realizadas').nextElementSibling?.textContent).toBe('2');
    expect(within(bob).getByText('Total vendido').nextElementSibling?.textContent).toBe('Bs 111,36');
    expect(within(bob).getByText('Cobrado en efectivo').nextElementSibling?.textContent).toBe('Bs 111,36');
    expect(screen.getByRole('button', { name: 'Actualizar' })).toBeTruthy();
  });

  it('sin turno abierto lo dice y no falla', async () => {
    const e = crearEntorno('caj');
    ver(e, 'reporte');
    expect(await screen.findByText(/No tiene un turno abierto/)).toBeTruthy();
  });

  it('lista los turnos cerrados y abre su detalle con sus ventas', async () => {
    const e = crearEntorno('caj');
    const turnoId = uuid();
    await e.api.llamar('abrirTurno', { turnoId, apertura: { BOB: 10000 } });
    await vender(e, 1);
    await e.api.llamar('cerrarTurno', { turnoId, contado: { BOB: 15568 } });
    ver(e, 'reporte');
    const u = userEvent.setup();
    await screen.findByRole('heading', { name: 'Días anteriores' });
    await u.click(await screen.findByRole('button', { name: /^Ver turno/ }));
    await screen.findByRole('heading', { name: 'Ventas del turno' });
    await waitFor(() => expect(screen.getAllByRole('row').length).toBeGreaterThan(2));
    expect(screen.getAllByText('Confirmada').length).toBe(1);
  });
});

/** Recibos de las filas de la tabla, recorriendo todas sus páginas (la tabla muestra de a 25) y volviendo a la primera. */
async function recibosDeLaTabla(u: ReturnType<typeof userEvent.setup>): Promise<string[]> {
  const filas = (): string[] => within(screen.getByRole('table', { name: 'Ventas registradas' })).getAllByRole('rowheader').map((x) => x.textContent ?? '');
  const salida = [...filas()];
  for (let i = 0; i < 10; i++) {
    const sig = screen.queryByRole('button', { name: 'Siguiente' }) as HTMLButtonElement | null;
    if (sig === null || sig.disabled) break;
    await u.click(sig);
    salida.push(...filas());
  }
  for (let i = 0; i < 10; i++) {
    const ant = screen.queryByRole('button', { name: 'Anterior' }) as HTMLButtonElement | null;
    if (ant === null || ant.disabled) break;
    await u.click(ant);
  }
  return salida;
}

describe('«Ventas y anulaciones» con «Cargar más»', () => {
  it('muestra 50 ventas y carga las siguientes con el botón', async () => {
    const e = crearEntorno('caj');
    e.como('adm');
    await e.api.llamar('ingresar', { operacionId: uuid(), ubicacionId: 'tienda', lineas: [{ productoId: 'cable-hdmi', cantidad: 40 }] });
    e.como('caj');
    await abrir(e);
    await vender(e, 55);
    ver(e, 'historial');
    const u = userEvent.setup();
    const mas = await screen.findByRole('button', { name: 'Cargar más' });
    expect((await e.api.llamar('misVentas', {})).ventas).toHaveLength(50);
    // Mientras haya más páginas avisa que la búsqueda solo alcanza lo cargado.
    expect(screen.getByText(/Busca solo entre las ventas cargadas/)).toBeTruthy();
    expect(await recibosDeLaTabla(u)).toHaveLength(50);
    await u.click(mas);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cargar más' })).toBeNull());
    const todos = await recibosDeLaTabla(u);
    expect(todos).toHaveLength(55);
    expect(new Set(todos).size).toBe(55);
    expect(screen.queryByText(/Busca solo entre las ventas cargadas/)).toBeNull();
    expect(e.api.llamadas.filter((l) => l.nombre === 'misVentas').length).toBeGreaterThanOrEqual(2);
  });
});

describe('usePaginado: una respuesta tardía no pisa un filtro nuevo', () => {
  it('«Cargar más» que llega después de cambiar el filtro se descarta', async () => {
    const pendientes: ((r: { filas: string[]; siguiente: number | null }) => void)[] = [];
    let cambiar: (f: string) => void = () => undefined;
    function Prueba(): ReturnType<typeof h> {
      const [filtro, setFiltro] = useState('a');
      cambiar = setFiltro;
      const p = usePaginado<string, number>(
        (cursor) => (cursor === undefined ? Promise.resolve({ filas: [`${filtro}1`], siguiente: 1 }) : new Promise((r) => { pendientes.push(r); })),
        [filtro],
      );
      return h('div', null, h('p', { 'data-testid': 'filas' }, p.filas.join(',')), h('button', { onClick: p.cargarMas }, 'mas'));
    }
    render(h(Prueba, null));
    await waitFor(() => expect(screen.getByTestId('filas').textContent).toBe('a1'));
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'mas' }));
    expect(pendientes).toHaveLength(1);
    act(() => cambiar('b'));
    await waitFor(() => expect(screen.getByTestId('filas').textContent).toBe('b1'));
    // Deja que corran los efectos del cambio de filtro: la respuesta vieja llega después, que es el caso que se descarta.
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    await act(async () => { pendientes[0]?.({ filas: ['a2'], siguiente: null }); await new Promise((r) => setTimeout(r, 30)); });
    expect(screen.getByTestId('filas').textContent).toBe('b1');
  });
});

describe('«Mi reporte» de sup y adm: solo lo propio', () => {
  it('envía el uid de la sesión en el resumen y en los turnos, y no muestra turnos ajenos', async () => {
    const e = crearEntorno('caj');
    await abrir(e);
    await vender(e, 1);
    e.como('sup');
    ver(e, 'reporte');
    await screen.findByRole('heading', { name: 'Turno actual' });
    await screen.findByRole('heading', { name: 'Días anteriores' });
    const lo = (n: string): { cajeroUid?: string }[] => e.api.llamadas.filter((l) => l.nombre === n).map((l) => l.entrada as { cajeroUid?: string });
    await waitFor(() => expect(lo('resumenTurno').length).toBeGreaterThan(0));
    expect(lo('resumenTurno').every((x) => typeof x.cajeroUid === 'string')).toBe(true);
    expect(lo('misTurnos').every((x) => typeof x.cajeroUid === 'string')).toBe(true);
    // El turno abierto es del cajero: la supervisora no lo ve como suyo.
    expect(await screen.findByText(/No tiene un turno abierto/)).toBeTruthy();
  });
});
