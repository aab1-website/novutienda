// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, render, screen, waitFor, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AHORA, crearEntorno, uuid, type Entorno } from '../../ayuda-pruebas.js';
import type { EstadoEnvio, Recibo } from '../../api/tipos.js';
import { ReciboVista } from './recibo-vista.js';
import { PantallaRecibos, TOPE_LISTA, textoEnvio } from './recibos.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function conRecibo(): Promise<{ e: Entorno; base: Recibo }> {
  const e = crearEntorno('caj');
  await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 10000 } });
  const ventaId = uuid();
  await e.api.llamar('confirmarVenta', {
    requestId: ventaId,
    carrito: { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'cable-hdmi', cantidad: 1 }], cliente: { nombre: 'Cliente de prueba', telefono: '70012345' } },
    pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 5568 }],
  });
  const base = await e.api.llamar('obtenerRecibo', { ventaId });
  if (!base) throw new Error('sin recibo');
  return { e, base };
}

/** Responde la búsqueda con una lista armada a partir de un recibo real. */
function lista(e: Entorno, filas: readonly Recibo[]): void {
  const original = e.api.llamar.bind(e.api);
  vi.spyOn(e.api, 'llamar').mockImplementation((async (n: string, en: never) => (n === 'buscarComprobantes' ? filas : original(n as never, en))) as never);
}

describe('textoEnvio', () => {
  const estados: EstadoEnvio[] = ['no_enviado', 'sin_telefono', 'enlace_generado', 'enviado', 'fallido'];
  it.each(estados)('«%s» se muestra con texto legible, no crudo', (estado) => {
    const t = textoEnvio(estado);
    expect(t).not.toBe(estado);
    expect(t).not.toMatch(/_/);
    expect(t).toMatch(/^[A-ZÁÉÍÓÚ]/);
  });
  it('un valor desconocido no se muestra crudo', () => {
    expect(textoEnvio('raro' as EstadoEnvio)).toBe('Estado desconocido');
  });
});

describe('Archivo de recibos', () => {
  it('«Recibos emitidos» usa tarjetas en el celular, para que «Ver» no quede fuera de la vista', async () => {
    const { e, base } = await conRecibo();
    lista(e, [base]);
    render(e.envolver(h(PantallaRecibos, {})));
    await screen.findByRole('button', { name: `Ver recibo ${base.numero}` });
    expect(document.querySelector('table.tabla-tarjetas')).not.toBeNull();
  });
  it('«Ver» abre el recibo en un diálogo con el foco dentro y lo devuelve al botón al cerrar', async () => {
    const { e, base } = await conRecibo();
    lista(e, [base]);
    const u = userEvent.setup();
    render(e.envolver(h(PantallaRecibos, {})));
    const ver = await screen.findByRole('button', { name: `Ver recibo ${base.numero}` });
    await u.click(ver);
    const dialogo = await screen.findByRole('dialog', { name: `Recibo ${base.numero}` });
    expect(dialogo.contains(document.activeElement)).toBe(true);
    await u.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: `Ver recibo ${base.numero}` }));
  });

  it('muestra el estado de envío en el diálogo con texto legible', async () => {
    const { e, base } = await conRecibo();
    lista(e, [{ ...base, envioWhatsapp: { estado: 'enlace_generado' } }]);
    const u = userEvent.setup();
    render(e.envolver(h(PantallaRecibos, {})));
    await u.click(await screen.findByRole('button', { name: `Ver recibo ${base.numero}` }));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText(/WhatsApp: Enlace preparado/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/enlace_generado/);
  });

  it('avisa cuando la lista está cortada por el tope del servidor', async () => {
    const { e, base } = await conRecibo();
    lista(e, Array.from({ length: TOPE_LISTA }, (_, i) => ({ ...base, reciboId: `r${String(i)}`, numero: `A-${String(i + 1).padStart(6, '0')}`, emitidoEn: new Date(AHORA - i * 1000).toISOString() })));
    render(e.envolver(h(PantallaRecibos, {})));
    expect(await screen.findByText(/Se muestran los 50 recibos más recientes/)).toBeTruthy();
    expect(screen.getByRole('navigation', { name: /Páginas/ })).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: 'Buscar en esta lista' })).toBeTruthy();
  });

  it('no avisa de corte con una lista corta', async () => {
    const { e, base } = await conRecibo();
    lista(e, [base]);
    render(e.envolver(h(PantallaRecibos, {})));
    await screen.findByRole('button', { name: `Ver recibo ${base.numero}` });
    expect(screen.queryByText(/más recientes/)).toBeNull();
  });

  it('el resultado del envío por WhatsApp sale por los avisos compartidos', async () => {
    const { e, base } = await conRecibo();
    const u = userEvent.setup();
    render(e.envolver(h(PantallaRecibos, {})));
    await u.click(await screen.findByRole('button', { name: `Ver recibo ${base.numero}` }));
    await u.click(await screen.findByRole('button', { name: 'Preparar WhatsApp' }));
    const region = document.querySelector('[data-region="avisos-estado"]') as HTMLElement;
    expect(await within(region).findByText('Enlace de WhatsApp preparado.')).toBeTruthy();
  });

  it('un error de la acción se ve junto a ella y también como aviso', async () => {
    const { e, base } = await conRecibo();
    const original = e.api.llamar.bind(e.api);
    vi.spyOn(e.api, 'llamar').mockImplementation((async (n: string, en: never) => {
      if (n === 'enviarRecibo') throw new Error('fallo de prueba');
      return original(n as never, en);
    }) as never);
    const u = userEvent.setup();
    render(e.envolver(h(PantallaRecibos, {})));
    await u.click(await screen.findByRole('button', { name: `Ver recibo ${base.numero}` }));
    await u.click(await screen.findByRole('button', { name: 'Preparar WhatsApp' }));
    await waitFor(() => expect(document.querySelectorAll('.aviso-error').length).toBeGreaterThan(0));
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toBeTruthy();
  });
});

describe('ReciboVista: cambio', () => {
  it('muestra «Cambio» solo si el pago lo trae mayor que cero', async () => {
    const { base } = await conRecibo();
    const con: Recibo = { ...base, pagos: [{ medio: 'efectivo', moneda: 'USD', monto: 40000, cambio: 5000 }] };
    render(h(ReciboVista, { recibo: con }));
    expect(screen.getByText(/Cambio:/).textContent).toContain('50,00');
    cleanup();
    const sin: Recibo = { ...base, pagos: [{ medio: 'efectivo', moneda: 'USD', monto: 40000 }] };
    render(h(ReciboVista, { recibo: sin }));
    expect(screen.queryByText(/Cambio:/)).toBeNull();
  });
});
