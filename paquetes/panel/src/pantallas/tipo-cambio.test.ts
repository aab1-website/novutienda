// @vitest-environment jsdom
// Pantalla «Tipo de cambio»: referencia, carga manual, salto de más del 5 %, vuelta al banco central e historial.
import { h } from 'preact';
import { cleanup, render, screen, waitFor, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { crearEntorno, type Entorno } from '../ayuda-pruebas.js';
import { PantallaTipoCambio, leerValor } from './tipo-cambio.js';

afterEach(cleanup);
const ver = (e: Entorno): void => void render(e.envolver(h(PantallaTipoCambio, {})));
const tarjeta = async (titulo: RegExp): Promise<HTMLElement> => (await screen.findByRole('heading', { name: titulo })).closest('section') as HTMLElement;

describe('pantalla Tipo de cambio', () => {
  it('lee el valor con coma o punto y rechaza lo que no sirve', () => {
    expect(leerValor('6,96')).toBe(6.96);
    expect(leerValor(' 1000.5 ')).toBe(1000.5);
    for (const malo of ['', '0', '-1', 'abc', '1,1234567', '1e3', '1.000,5']) expect(leerValor(malo)).toBeNull();
  });

  it('muestra por mercado la referencia del banco central, sin manual', async () => {
    ver(crearEntorno('adm'));
    const bo = await tarjeta(/Bolivia/);
    expect(within(bo).getByText(/Banco Central de Bolivia/)).toBeTruthy();
    expect(within(bo).getByText('No hay uno cargado')).toBeTruthy();
    expect(within(bo).queryByRole('button', { name: /Volver al del banco central/ })).toBeNull();
    expect(await tarjeta(/Argentina/)).toBeTruthy();
  });

  it('carga un manual dentro del 5 %, lo muestra con quién lo cargó y lo deja en el historial', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    const bo = await tarjeta(/Bolivia/);
    await u.type(within(bo).getByLabelText(/Nuevo valor manual/), '7,00');
    await u.click(within(bo).getByRole('button', { name: 'Guardar valor manual' }));
    await waitFor(() => expect(within(bo).getByText(/cargado por/)).toBeTruthy());
    expect(within(bo).getByText(/Hoy rige el valor manual/)).toBeTruthy();
    expect(within(bo).getAllByText(/7,00/).length).toBeGreaterThan(0);
    expect(within(bo).getByText('Cargó un valor manual')).toBeTruthy();
    expect(within(bo).getByRole('button', { name: /Volver al del banco central/ })).toBeTruthy();
  });

  it('un salto de más del 5 % pide confirmar en la misma pantalla y no guarda hasta confirmar', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    const bo = await tarjeta(/Bolivia/);
    await u.type(within(bo).getByLabelText(/Nuevo valor manual/), '9');
    await u.click(within(bo).getByRole('button', { name: 'Guardar valor manual' }));
    expect(await within(bo).findByText(/cambia más del 5 %/)).toBeTruthy();
    expect(within(bo).getByText('No hay uno cargado')).toBeTruthy();
    await u.click(within(bo).getByRole('button', { name: 'Sí, guardar este valor' }));
    await waitFor(() => expect(within(bo).getByText(/cargado por/)).toBeTruthy());
    expect(e.api.llamadas.filter((l) => l.nombre === 'cotizacionManual').map((l) => (l.entrada as { confirmarSalto?: boolean }).confirmarSalto)).toEqual([undefined, true]);
  });

  it('un valor inválido no llega al servidor', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    const bo = await tarjeta(/Bolivia/);
    await u.type(within(bo).getByLabelText(/Nuevo valor manual/), '0');
    await u.click(within(bo).getByRole('button', { name: 'Guardar valor manual' }));
    expect(await within(bo).findByText(/Escriba un número mayor que cero/)).toBeTruthy();
    expect(e.api.llamadas.map((l) => l.nombre)).not.toContain('cotizacionManual');
  });

  it('«Volver al del banco central» pide confirmación y deja el registro', async () => {
    const e = crearEntorno('adm');
    await e.api.llamar('cotizacionManual', { mercado: 'BO', valor: 7 });
    ver(e);
    const u = userEvent.setup();
    const bo = await tarjeta(/Bolivia/);
    await u.click(await within(bo).findByRole('button', { name: /Volver al del banco central/ }));
    expect(e.api.llamadas.map((l) => l.nombre)).not.toContain('quitarCotizacionManual');
    await u.click(await screen.findByRole('button', { name: 'Sí, volver al del banco central' }));
    await waitFor(() => expect(within(bo).getByText('No hay uno cargado')).toBeTruthy());
    expect(within(bo).getByText('Volvió al del banco central')).toBeTruthy();
  });
});
