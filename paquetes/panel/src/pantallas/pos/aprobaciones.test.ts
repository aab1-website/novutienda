// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, render, screen, waitFor, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearEntorno, uuid, type Entorno } from '../../ayuda-pruebas.js';
import { PantallaAprobaciones, RECHAZO_CON_MOTIVO } from './aprobaciones.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const boton = (nombre: string | RegExp): HTMLElement => screen.getByRole('button', { name: nombre });

/** La cajera pide un descuento; luego el supervisor abre la pantalla de aprobaciones. */
async function pedir(e: Entorno, monto = 1000): Promise<string> {
  const aprobacionId = uuid();
  await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 0 } });
  await e.api.llamar('solicitarAprobacion', { aprobacionId, solicitud: { tipo: 'descuento', moneda: 'BOB', monto, motivo: 'Cliente frecuente' } });
  return aprobacionId;
}

const resoluciones = (e: Entorno): { aprobacionId: string; decision: string }[] => e.api.llamadas.filter((l) => l.nombre === 'resolverAprobacion').map((l) => l.entrada as { aprobacionId: string; decision: string });

describe('aprobaciones: confirmar antes de resolver (A-02)', () => {
  it('aprobar pide confirmación con el resumen y el correo de quien lo pide, y avisa el resultado', async () => {
    const e = crearEntorno('caj');
    await pedir(e);
    e.como('sup');
    render(e.envolver(h(PantallaAprobaciones, { sub: 'descuentos' })));
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Aprobar solicitud de descuento' }));
    const dialogo = await screen.findByRole('dialog', { name: '¿Aprobar esta solicitud?' });
    expect(resoluciones(e)).toHaveLength(0);
    const resumen = within(dialogo).getByText(/Descuento hasta Bs 10,00/).closest('ul');
    expect(resumen?.textContent).toContain('Cliente frecuente');
    expect(resumen?.textContent).toContain('caj@ejemplo.test');
    expect(resumen?.textContent).not.toContain('u-caj');
    await u.click(within(dialogo).getByRole('button', { name: 'Sí, aprobar' }));
    expect(await screen.findByText('Solicitud aprobada.')).toBeTruthy();
    expect(resoluciones(e)).toEqual([expect.objectContaining({ decision: 'aprobar' })]);
    await screen.findByText('No hay solicitudes pendientes');
  });

  it('«Volver» no resuelve nada; rechazar confirma y no envía motivo todavía', async () => {
    const e = crearEntorno('caj');
    await pedir(e);
    e.como('sup');
    render(e.envolver(h(PantallaAprobaciones, { sub: 'descuentos' })));
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Rechazar solicitud de descuento' }));
    const dialogo = await screen.findByRole('dialog', { name: '¿Rechazar esta solicitud?' });
    // El motivo del rechazo queda preparado, pero apagado hasta que cambien el servidor y el contrato.
    expect(RECHAZO_CON_MOTIVO).toBe(false);
    expect(within(dialogo).queryByLabelText(/Motivo del rechazo/)).toBeNull();
    await u.click(within(dialogo).getByRole('button', { name: 'Volver' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(resoluciones(e)).toHaveLength(0);
    await u.click(screen.getByRole('button', { name: 'Rechazar solicitud de descuento' }));
    await u.click(await screen.findByRole('button', { name: 'Sí, rechazar' }));
    expect(await screen.findByText('Solicitud rechazada.')).toBeTruthy();
    expect(resoluciones(e)).toEqual([{ aprobacionId: expect.any(String), decision: 'rechazar' }]);
  });

  it('solo la fila que se está resolviendo dice «Procesando…»', async () => {
    const e = crearEntorno('caj');
    await pedir(e, 1000);
    await e.api.llamar('solicitarAprobacion', { aprobacionId: uuid(), solicitud: { tipo: 'descuento', moneda: 'BOB', monto: 2000, motivo: 'Otro' } });
    e.como('sup');
    const original = e.api.llamar.bind(e.api);
    let soltar: () => void = () => undefined;
    const compuerta = new Promise<void>((res) => { soltar = res; });
    (e.api as { llamar: unknown }).llamar = async (n: string, entrada: unknown) => {
      if (n === 'resolverAprobacion') await compuerta;
      return original(n as never, entrada as never);
    };
    render(e.envolver(h(PantallaAprobaciones, { sub: 'descuentos' })));
    const u = userEvent.setup();
    await screen.findAllByRole('button', { name: 'Aprobar solicitud de descuento' });
    await u.click(screen.getAllByRole('button', { name: 'Aprobar solicitud de descuento' })[0] as HTMLElement);
    await u.click(await screen.findByRole('button', { name: 'Sí, aprobar' }));
    await waitFor(() => expect(document.querySelectorAll('.tarjeta-interna [aria-busy="true"]')).toHaveLength(1));
    const filas = [...document.querySelectorAll('.tarjeta-interna')];
    expect(filas.filter((f) => f.textContent?.includes('Procesando…'))).toHaveLength(1);
    soltar();
    await waitFor(() => expect(document.querySelectorAll('.tarjeta-interna')).toHaveLength(1));
    expect(document.body.textContent).not.toContain('Procesando…');
  });
});

describe('aprobaciones: lista viva (A-01)', () => {
  it('descuentos: consulta cada 10 s y tiene «Actualizar»', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const e = crearEntorno('caj');
    await pedir(e);
    e.como('sup');
    render(e.envolver(h(PantallaAprobaciones, { sub: 'descuentos' })));
    await screen.findByRole('button', { name: 'Aprobar solicitud de descuento' });
    // Otra solicitud llega mientras el supervisor mira la pantalla.
    e.como('caj');
    await e.api.llamar('solicitarAprobacion', { aprobacionId: uuid(), solicitud: { tipo: 'descuento', moneda: 'BOB', monto: 3000, motivo: 'Segunda' } });
    e.como('sup');
    expect(screen.getAllByRole('button', { name: 'Aprobar solicitud de descuento' })).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Aprobar solicitud de descuento' })).toHaveLength(2));
    // Y a mano.
    e.como('caj');
    await e.api.llamar('solicitarAprobacion', { aprobacionId: uuid(), solicitud: { tipo: 'descuento', moneda: 'BOB', monto: 4000, motivo: 'Tercera' } });
    e.como('sup');
    await userEvent.setup({ advanceTimers: () => undefined }).click(boton('Actualizar'));
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Aprobar solicitud de descuento' })).toHaveLength(3));
  });

  it('anulaciones: también se actualiza sola y tiene «Actualizar»', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const e = crearEntorno('sup');
    render(e.envolver(h(PantallaAprobaciones, { sub: 'anulaciones' })));
    await screen.findByText('No hay anulaciones pendientes');
    expect(boton('Actualizar')).toBeTruthy();
    const antes = e.api.llamadas.filter((l) => l.nombre === 'listarVentas').length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(e.api.llamadas.filter((l) => l.nombre === 'listarVentas').length).toBe(antes + 1);
  });
});
