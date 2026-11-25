// @vitest-environment jsdom
// Sección «Redondeo de precios»: el administrador solo la ve, en palabras simples; el operador la cambia con confirmación.
import { h } from 'preact';
import { cleanup, render, screen, waitFor, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { crearEntorno, type Entorno } from '../ayuda-pruebas.js';
import { SeccionRedondeo, ejemploDeRegla, textoDeRegla } from './redondeo.js';

afterEach(cleanup);
const REGLAS = { BOB: { tipo: 'decimales', decimales: 0, modo: 'cercano' }, ARS: { tipo: 'multiplo', multiplo: 1000, modo: 'cercano' } } as const;
const ver = (e: Entorno): void => void render(e.envolver(h(SeccionRedondeo, {})));

describe('redondeo en palabras simples', () => {
  it('describe cada regla con un ejemplo, sin jerga', () => {
    expect(textoDeRegla(REGLAS.BOB)).toBe('sin decimales');
    expect(textoDeRegla(REGLAS.ARS)).toBe('de mil en mil');
    expect(textoDeRegla({ tipo: 'decimales', decimales: 2, modo: 'arriba' })).toBe('con 2 decimales, siempre hacia arriba');
    expect(textoDeRegla({ tipo: 'multiplo', multiplo: 0.5, modo: 'abajo' })).toBe('de 0,5 en 0,5, siempre hacia abajo');
    expect(ejemploDeRegla(REGLAS.BOB, 'BOB')).toBe('Bs 3.431');
    expect(ejemploDeRegla(REGLAS.ARS, 'ARS')).toBe('$ 521.000');
  });
});

describe('pantalla Redondeo', () => {
  it('el administrador ve la regla de cada moneda y no tiene formulario', async () => {
    const e = crearEntorno('adm', undefined, { redondeo: REGLAS });
    ver(e);
    expect(await screen.findByText('Bolivianos: sin decimales (Bs 3.431)')).toBeTruthy();
    expect(screen.getByText('Pesos: de mil en mil ($ 521.000)')).toBeTruthy();
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.queryByRole('button', { name: /Guardar el redondeo/ })).toBeNull();
    expect(screen.getByText(/Solo lo cambia el operador de NovuTienda/)).toBeTruthy();
  });

  it('el administrador no puede fijar aunque llame: el servidor lo rechaza', async () => {
    const e = crearEntorno('adm', undefined, { redondeo: REGLAS });
    await expect(e.api.llamar('cambiarRedondeo', { reglas: REGLAS, esperadas: REGLAS })).rejects.toMatchObject({ codigoHttps: 'permission-denied' });
  });

  it('el operador cambia el redondeo tras confirmar el aviso y queda guardado', async () => {
    const e = crearEntorno('adm', undefined, { redondeo: REGLAS, operador: true });
    ver(e);
    const u = userEvent.setup();
    const form = await screen.findByRole('form', { name: /Cambiar el redondeo/ });
    expect(within(form).getByRole('button', { name: 'Guardar el redondeo' }).hasAttribute('disabled')).toBe(true);
    await u.selectOptions(within(form).getByLabelText('Decimales (Bolivianos)'), '2');
    await u.click(within(form).getByRole('button', { name: 'Guardar el redondeo' }));
    expect(await screen.findByText(/Cambian los precios de la caja, de la web y de WhatsApp, y el sitio se reconstruye/)).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Sí, cambiar el redondeo' }));
    await waitFor(() => expect(e.api.estado.redondeo['BOB']).toEqual({ tipo: 'decimales', decimales: 2, modo: 'cercano' }));
    expect(e.api.estado.redondeo['ARS']).toEqual(REGLAS.ARS);
    expect(await screen.findByText('Bolivianos: con 2 decimales (Bs 3.431,46)')).toBeTruthy();
    expect(e.api.estado.auditoria.some((a) => a.accion === 'redondeo.fijar')).toBe(true);
  });

  it('un múltiplo inválido no llega al servidor', async () => {
    const e = crearEntorno('adm', undefined, { redondeo: REGLAS, operador: true });
    ver(e);
    const u = userEvent.setup();
    const campo = await screen.findByLabelText(/De cuánto en cuánto \(Pesos\)/);
    await u.clear(campo);
    await u.type(campo, 'abc');
    await u.click(screen.getByRole('button', { name: 'Guardar el redondeo' }));
    await u.click(await screen.findByRole('button', { name: 'Sí, cambiar el redondeo' }));
    expect(await screen.findByText(/Escriba un número mayor que cero/)).toBeTruthy();
    expect(e.api.llamadas.some((l) => l.nombre === 'cambiarRedondeo')).toBe(false);
  });

  it('si otra persona lo cambió antes, avisa y muestra las reglas vigentes sin pisarlas', async () => {
    const e = crearEntorno('adm', undefined, { redondeo: REGLAS, operador: true });
    ver(e);
    const u = userEvent.setup();
    const form = await screen.findByRole('form', { name: /Cambiar el redondeo/ });
    await u.selectOptions(within(form).getByLabelText('Decimales (Bolivianos)'), '1');
    e.api.estado.redondeo = { ...REGLAS, BOB: { tipo: 'decimales', decimales: 2, modo: 'arriba' } };
    await u.click(within(form).getByRole('button', { name: 'Guardar el redondeo' }));
    await u.click(await screen.findByRole('button', { name: 'Sí, cambiar el redondeo' }));
    expect((await screen.findAllByText(/Otra persona cambió el redondeo/)).length).toBeGreaterThan(0);
    expect(e.api.estado.redondeo['BOB']).toEqual({ tipo: 'decimales', decimales: 2, modo: 'arriba' });
    expect(await screen.findByText('Bolivianos: con 2 decimales, siempre hacia arriba (Bs 3.431,46)')).toBeTruthy();
  });
});
