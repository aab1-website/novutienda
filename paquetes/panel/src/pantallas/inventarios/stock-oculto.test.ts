// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, render, screen, waitFor, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { Rol } from '../../api/tipos.js';
import { AHORA, crearEntorno, uuid, type Entorno } from '../../ayuda-pruebas.js';
import { ProveedorGuardia } from '../../ui/guardia.js';
import { PantallaInventario } from './inventario.js';
import { resumenAjuste, revisarLineas, haySeQuedan } from './movimientos-resumen.js';
import { revisarSolicitud, resumenResolucion, MERMA_INICIAL } from './mermas-logica.js';

afterEach(cleanup);

/** Abre un conteo de la tienda como `sup` y deja el entorno en el rol pedido. */
async function conConteo(rol: Rol, ubicacion: 'tienda' | 'deposito-1' = 'tienda'): Promise<Entorno> {
  const e = crearEntorno('sup');
  await e.api.llamar('abrirConteo', { operacionId: uuid(), conteoId: `conteo-${ubicacion}`, ubicacionId: ubicacion });
  e.como(rol);
  return e;
}
const ver = (e: Entorno, sub: string): void => void render(e.envolver(h(ProveedorGuardia, null, h(PantallaInventario, { sub }))));
const tabla = async (): Promise<HTMLElement> => screen.findByRole('table', { name: 'Productos y existencias por almacén' });

describe.each(['caj', 'sup'] as const)('productos como %s con un conteo abierto', (rol) => {
  it('oculta tienda, total y estado, avisa, desactiva el filtro con motivo y no muestra ninguna cantidad ni «0»', async () => {
    const e = await conConteo(rol);
    ver(e, 'productos');
    const t = await tabla();
    expect(within(t).getAllByText('Oculto').length).toBeGreaterThan(0);
    expect(screen.getByText(/Hay un conteo abierto en Tienda desde/)).toBeTruthy();
    expect(screen.getByText(/No disponible mientras hay un conteo abierto/)).toBeTruthy();
    expect(screen.queryByText(/productos? bajo el mínimo/)).toBeNull();
    expect(within(screen.getByLabelText('Mostrar')).queryByRole('option', { name: 'Bajo el mínimo' })).toBeNull();
    // La tienda (en conteo), el total y el estado de cada fila son «Oculto»: ninguna cantidad ni «0» ni «Agotado».
    const filas = within(t).getAllByRole('row').slice(1);
    expect(filas.length).toBeGreaterThan(0);
    for (const fila of filas) {
      for (const etiqueta of ['Tienda', 'Total', 'Estado']) {
        const celda = fila.querySelector(`[data-etiqueta="${etiqueta}"]`);
        expect(celda?.textContent).toBe('Oculto');
      }
    }
    expect(within(t).queryByText(/Disponible|Agotado/)).toBeNull();
  });

  it('al cerrar el conteo vuelven las cifras, el filtro y la línea de «bajo el mínimo»', async () => {
    const e = await conConteo(rol);
    e.como('sup');
    const conteos = await e.api.llamar('listarConteos', {});
    const abierto = conteos.find((c) => c.estado === 'abierto');
    expect(abierto).toBeTruthy();
    await e.api.llamar('cerrarConteo', { operacionId: uuid(), conteoId: abierto?.conteoId ?? '' });
    e.como(rol);
    ver(e, 'productos');
    const t = await tabla();
    expect(within(t).queryByText('Oculto')).toBeNull();
    expect(screen.queryByText(/Hay un conteo abierto/)).toBeNull();
    expect(screen.getByText(/2 productos bajo el mínimo/)).toBeTruthy();
    expect(within(screen.getByLabelText('Mostrar')).getByRole('option', { name: 'Bajo el mínimo' })).toBeTruthy();
  });
});

describe('productos como adm con un conteo abierto', () => {
  it('ve todo y no hay aviso ni «Oculto»', async () => {
    const e = await conConteo('adm');
    ver(e, 'productos');
    const t = await tabla();
    expect(within(t).queryByText('Oculto')).toBeNull();
    expect(screen.queryByText(/Hay un conteo abierto/)).toBeNull();
    expect(screen.getByText(/2 productos bajo el mínimo/)).toBeTruthy();
    expect(within(screen.getByLabelText('Mostrar')).getByRole('option', { name: 'Bajo el mínimo' })).toBeTruthy();
  });
});

describe('conteo abierto hace más de 24 horas', () => {
  it('el aviso pasa a tono de alerta', async () => {
    const e = crearEntorno('sup', () => AHORA + 25 * 3600_000);
    await e.api.llamar('abrirConteo', { operacionId: uuid(), conteoId: 'c-viejo', ubicacionId: 'tienda' });
    e.como('caj');
    ver(e, 'productos');
    await tabla();
    expect(screen.getByText(/Hay un conteo abierto en Tienda/)).toBeTruthy();
  });
});

describe('movimientos y registro como sup con un conteo abierto', () => {
  it('el registro no muestra saldos ni cantidades de existencia', async () => {
    const e = crearEntorno('sup');
    await e.api.llamar('ingresar', { operacionId: uuid(), ubicacionId: 'tienda', lineas: [{ productoId: 'cable-hdmi', cantidad: 1 }] });
    await e.api.llamar('abrirConteo', { operacionId: uuid(), conteoId: 'c1', ubicacionId: 'tienda' });
    ver(e, 'registro');
    const t = await screen.findByRole('table', { name: 'Movimientos de inventario' });
    expect(within(t).queryByText('Saldo')).toBeNull();
    expect(within(t).getAllByText('Ingreso').length).toBeGreaterThan(0);
  });

  it('traspaso: la ayuda de la cantidad no dice «hay N» de un almacén en conteo', async () => {
    const e = await conConteo('sup', 'deposito-1');
    ver(e, 'traspasos');
    expect(await screen.findByText(/Hay un conteo abierto en Depósito 1/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/ hay \d+\./)).toBeNull());
  });
});

describe('lógica sin existencias', () => {
  const producto = { id: 'x', nombre: 'X', sku: 'X', conSerie: false, activo: true, existencias: { tienda: null, 'deposito-1': 5, 'deposito-2': 0 }, stockTotal: null, bajoMinimo: null, disponible: null } as never;
  it('el resumen del ajuste dice que están ocultas y no trae cifras', () => {
    const r = resumenAjuste(producto, 'tienda', -3, 'rotura');
    expect(r.lineas[0]).toContain('Las existencias están ocultas mientras hay un conteo abierto; el servidor valida al registrar.');
    expect(r.lineas[0]).not.toMatch(/Hay \d|quedarán/);
  });
  it('«hay/quedarán» no se calcula, y un traspaso o una merma no se rechazan en el panel por una cifra oculta', () => {
    expect(haySeQuedan(producto, 'tienda', 2)).toBeNull();
    expect(revisarLineas([{ id: 'a', productoId: 'x', cantidad: '999', series: '' }], [producto], 'tienda').lineas).not.toBeNull();
    expect(revisarSolicitud({ ...MERMA_INICIAL, productoId: 'x', cantidad: '999', motivo: 'm' }, producto)).toEqual({});
  });
  it('la resolución de una merma no trae cifras de existencia', () => {
    const m = { mermaId: 'm', productoId: 'x', ubicacionId: 'tienda', cantidad: 2, series: [], motivo: 'm', estado: 'solicitada', fecha: '' } as never;
    const l = resumenResolucion(m, producto, 'aprobada').join(' ');
    expect(l).toContain('ocultas');
    expect(l).not.toMatch(/quedarán/);
  });
});

describe('series con la lista oculta', () => {
  it('conserva el formulario de búsqueda', async () => {
    const e = await conConteo('sup');
    ver(e, 'series');
    expect(await screen.findByRole('button', { name: 'Buscar' })).toBeTruthy();
    await userEvent.setup().type(screen.getByLabelText('Número de serie (o parte)'), 'ABC');
  });
});
