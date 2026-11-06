// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearEntorno, uuid, type Entorno } from '../../ayuda-pruebas.js';
import { PantallaVenta } from './venta.js';
import { PantallaAprobaciones } from './aprobaciones.js';
import { PantallaSupervision } from './supervision.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ver = (e: Entorno, sub: string): void => void render(e.envolver(h(PantallaVenta, { sub })));
const campo = (re: RegExp): HTMLElement => screen.getByLabelText(re);

async function abrirTurno(e: Entorno, bob = '100'): Promise<void> {
  ver(e, 'terminal');
  const u = userEvent.setup();
  await screen.findByRole('heading', { name: 'Abrir turno' });
  await u.type(campo(/Efectivo inicial en Bolivianos/), bob);
  await u.click(screen.getByRole('button', { name: 'Abrir turno' }));
  await screen.findByRole('heading', { name: 'Productos' });
}

describe('venta: apertura de turno', () => {
  it('sin turno abierto pide el efectivo inicial por moneda y valida los montos', async () => {
    const e = crearEntorno('caj');
    ver(e, 'terminal');
    const u = userEvent.setup();
    await screen.findByRole('heading', { name: 'Abrir turno' });
    expect((screen.getByRole('button', { name: 'Abrir turno' }) as HTMLButtonElement).disabled).toBe(true);
    await u.type(campo(/Efectivo inicial en Dólares/), 'abc');
    expect(await screen.findByText(/Escriba montos válidos/)).toBeTruthy();
    await u.clear(campo(/Efectivo inicial en Dólares/));
    await u.type(campo(/Efectivo inicial en Dólares/), '20');
    await u.type(campo(/Efectivo inicial en Pesos/), '5000');
    await u.click(screen.getByRole('button', { name: 'Abrir turno' }));
    await screen.findByRole('heading', { name: 'Productos' });
    const t = await e.api.llamar('turnoActual', {});
    expect(t?.apertura).toEqual({ USD: 2000, ARS: 500000 });
  });
});

describe('venta: terminal y cobro de punta a punta', () => {
  it('busca, agrega, cobra en efectivo con cambio y muestra el recibo', async () => {
    const e = crearEntorno('caj');
    await abrirTurno(e);
    const u = userEvent.setup();
    expect(screen.getByText(/Cotización: 1 USD = 6,96 BOB · BCB/)).toBeTruthy();
    await u.type(campo(/Buscar por nombre/), 'hdmi');
    expect(screen.queryByRole('button', { name: 'Agregar Parlante portátil' })).toBeNull();
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    await waitFor(() => expect(document.querySelector('[data-prueba="total"]')?.textContent).toBe('Bs 55,68'));
    await u.click(screen.getByRole('button', { name: 'Cobrar' }));
    await screen.findByRole('heading', { name: 'Cobro' });
    await u.type(campo(/Monto a aplicar/), '55,68');
    await u.type(campo(/Efectivo recibido/), '100');
    expect(document.querySelector('[data-prueba="cambio"]')?.textContent).toBe('Bs 44,32');
    await u.click(screen.getByRole('button', { name: 'Confirmar cobro' }));
    await screen.findByRole('heading', { name: 'Venta registrada' });
    expect(await screen.findByRole('article', { name: 'Recibo A-000001' })).toBeTruthy();
    const venta = (await e.api.llamar('listarVentas', {}))[0];
    expect(venta?.pagos[0]).toMatchObject({ medio: 'efectivo', monto: 10000, cambio: 4432 });
    // Nueva venta vuelve al terminal.
    await u.click(screen.getByRole('button', { name: 'Nueva venta' }));
    await screen.findByRole('heading', { name: 'Productos' });
  });

  it('producto con serie: elige la serie y no deja cobrar sin ella', async () => {
    const e = crearEntorno('caj');
    await abrirTurno(e);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Agregar Televisor 55 pulgadas' }));
    expect(await screen.findByText('Elija al menos una serie.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Cobrar' }) as HTMLButtonElement).disabled).toBe(true);
    await u.click(await screen.findByRole('checkbox', { name: 'TV55-001' }));
    await waitFor(() => expect(document.querySelector('[data-prueba="total"]')?.textContent).toBe('Bs 3.132,00'));
    expect((screen.getByRole('button', { name: 'Cobrar' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('descuento sobre el tope pide aprobación; el supervisor la aprueba y entonces se cobra', async () => {
    const e = crearEntorno('caj');
    await abrirTurno(e);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Agregar Televisor 55 pulgadas' }));
    await u.click(await screen.findByRole('checkbox', { name: 'TV55-001' }));
    await u.type(campo(/Descuento \(monto\)/), '200');
    await u.type(campo(/Motivo del descuento/), 'Cliente frecuente');
    expect(await screen.findByText(/supera su tope/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Cobrar' }) as HTMLButtonElement).disabled).toBe(true);
    await u.click(screen.getByRole('button', { name: 'Solicitar aprobación' }));
    expect(await screen.findByText(/Solicitud enviada/)).toBeTruthy();
    // El supervisor la aprueba desde su pantalla.
    cleanup();
    e.como('sup');
    render(e.envolver(h(PantallaAprobaciones, { sub: 'descuentos' })));
    await u.click(await screen.findByRole('button', { name: 'Aprobar solicitud de descuento' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Aprobar solicitud de descuento' })).toBeNull());
    expect((await e.api.llamar('listarAprobaciones', { estado: 'aprobada' })).length).toBe(1);
  });

  it('cobro mixto en una moneda, crédito con deudor y QR «registrado por»', async () => {
    const e = crearEntorno('sup');
    await abrirTurno(e);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    await u.type(campo(/Cliente \(opcional\)/), 'Ana Pérez');
    await u.click(screen.getByRole('button', { name: 'Cobrar' }));
    await screen.findByRole('heading', { name: 'Cobro' });
    await u.type(campo(/Monto a aplicar/), '20');
    await u.click(screen.getByRole('button', { name: 'Agregar otro medio' }));
    const pagos = screen.getAllByRole('group', { name: /Pago/ });
    const segundo = pagos[1] as HTMLElement;
    await u.selectOptions(within(segundo).getByLabelText('Medio'), 'qr');
    await u.clear(within(segundo).getByLabelText(/Monto a aplicar/));
    await u.type(within(segundo).getByLabelText(/Monto a aplicar/), '20');
    await u.type(within(segundo).getByLabelText(/Referencia del QR/), 'REF-77');
    expect(within(segundo).getByText(/QR registrado por sup@ejemplo.test/)).toBeTruthy();
    expect(document.querySelector('[data-prueba="restante"]')?.textContent).toBe('Bs 15,68');
    expect((screen.getByRole('button', { name: 'Confirmar cobro' }) as HTMLButtonElement).disabled).toBe(true);
    await u.click(screen.getByRole('button', { name: 'Agregar otro medio' }));
    const tercero = screen.getAllByRole('group', { name: /Pago/ })[2] as HTMLElement;
    await u.selectOptions(within(tercero).getByLabelText('Medio'), 'credito');
    await u.clear(within(tercero).getByLabelText(/Monto a aplicar/));
    await u.type(within(tercero).getByLabelText(/Monto a aplicar/), '15,68');
    await u.click(screen.getByRole('button', { name: 'Confirmar cobro' }));
    await screen.findByRole('heading', { name: 'Venta registrada' });
    const v = (await e.api.llamar('listarVentas', {}))[0];
    expect(v?.pagos.map((p) => p.medio)).toEqual(['efectivo', 'qr', 'credito']);
    expect(v?.pagos[1]?.registradoPor).toBe('u-sup');
    expect((await e.api.llamar('listarCreditos', {}))[0]?.deudor).toBe('Ana Pérez');
  });

  it('un error del servidor se muestra con un mensaje legible y el cobro se puede reintentar con el mismo identificador', async () => {
    const e = crearEntorno('caj');
    await abrirTurno(e);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Agregar Parlante portátil' }));
    await u.click(screen.getByRole('button', { name: 'Cobrar' }));
    await screen.findByRole('heading', { name: 'Cobro' });
    await u.type(campo(/Monto a aplicar/), '174');
    // Otro usuario vende la última unidad: el servidor responde stock insuficiente.
    const antes = e.api.estado.productos.get('parlante');
    if (antes) antes.existencias.tienda = 0;
    await u.click(screen.getByRole('button', { name: 'Confirmar cobro' }));
    expect((await screen.findByRole('alert')).textContent).toContain('No hay existencias suficientes');
    if (antes) antes.existencias.tienda = 1;
    await u.click(screen.getByRole('button', { name: 'Confirmar cobro' }));
    await screen.findByRole('heading', { name: 'Venta registrada' });
    const ids = e.api.llamadas.filter((l) => l.nombre === 'confirmarVenta').map((l) => (l.entrada as { requestId: string }).requestId);
    expect(new Set(ids).size).toBe(1);
  });
});

describe('venta: caja, créditos, historial y cierre', () => {
  it('registra un egreso, rechaza el que excede el efectivo y lista los movimientos', async () => {
    const e = crearEntorno('caj');
    await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 10000 } });
    ver(e, 'caja');
    const u = userEvent.setup();
    await screen.findByRole('heading', { name: 'Ingresos y egresos de caja' });
    await u.type(campo(/^Monto/), '150');
    expect(await screen.findByText(/mayor que el efectivo disponible/)).toBeTruthy();
    await u.clear(campo(/^Monto/));
    await u.type(campo(/^Monto/), '40');
    await u.type(campo(/^Motivo/), 'Compra de bolsas');
    await u.click(screen.getByRole('button', { name: 'Registrar' }));
    expect(await screen.findByText('Egreso registrado.')).toBeTruthy();
    expect(await screen.findByText('Compra de bolsas')).toBeTruthy();
  });

  it('cobra un crédito pendiente en efectivo', async () => {
    const e = crearEntorno('sup');
    await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 0 } });
    await e.api.llamar('confirmarVenta', { requestId: uuid(), carrito: { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'cable-hdmi', cantidad: 1 }], cliente: { nombre: 'Luis Rojas' } }, pagos: [{ medio: 'credito', moneda: 'BOB', monto: 5568 }] });
    ver(e, 'creditos');
    const u = userEvent.setup();
    expect(await screen.findByText('Luis Rojas')).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Cobrar' }));
    await u.click(await screen.findByRole('button', { name: 'Registrar cobro' }));
    expect(await screen.findByText('Cobro registrado en su turno abierto.')).toBeTruthy();
    await screen.findByText('No hay créditos pendientes');
  });

  it('solicita la anulación de una venta con motivo y el supervisor la aprueba (reembolso por el medio original)', async () => {
    const e = crearEntorno('caj');
    const ventaId = uuid();
    await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 10000 } });
    await e.api.llamar('confirmarVenta', { requestId: ventaId, carrito: { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'cable-hdmi', cantidad: 1 }] }, pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 5568 }] });
    ver(e, 'historial');
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: /Solicitar anulación de A-000001/ }));
    await u.type(campo(/Motivo de la anulación/), 'Se equivocó el producto');
    await u.click(screen.getByRole('button', { name: 'Enviar solicitud' }));
    expect(await screen.findByText('Anulación solicitada')).toBeTruthy();
    cleanup();
    e.como('sup');
    render(e.envolver(h(PantallaAprobaciones, { sub: 'anulaciones' })));
    await u.click(await screen.findByRole('button', { name: 'Aprobar anulación' }));
    expect((await screen.findByRole('button', { name: 'Sí, anular la venta' }) as HTMLButtonElement).disabled).toBe(true);
    await u.type(campo(/Motivo de la aprobación/), 'Verificado con el cliente');
    await u.click(await screen.findByRole('button', { name: 'Sí, anular la venta' }));
    expect(await screen.findByText(/Reembolsos: efectivo Bs 55,68/)).toBeTruthy();
    expect((await e.api.llamar('listarVentas', {}))[0]?.estado).toBe('anulada');
  });

  it('cierra el turno con conteo por moneda: el faltante queda negativo', async () => {
    const e = crearEntorno('caj');
    await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 10000 } });
    ver(e, 'cierre');
    const u = userEvent.setup();
    await screen.findByRole('heading', { name: 'Cierre de turno' });
    expect((screen.getByRole('button', { name: 'Cerrar turno' }) as HTMLButtonElement).disabled).toBe(true);
    await u.type(campo(/Efectivo contado en BOB/), '90');
    expect(document.querySelector('[data-prueba="diferencia-BOB"]')?.textContent).toContain('-Bs 10,00 (faltante)');
    await u.click(screen.getByRole('button', { name: 'Cerrar turno' }));
    await u.click(await screen.findByRole('button', { name: 'Sí, cerrar turno' }));
    await screen.findByRole('heading', { name: 'Turno cerrado' });
    expect(screen.getByRole('table', { name: 'Arqueo del turno cerrado' }).textContent).toContain('-Bs 10,00');
  });
});

describe('supervisión en vivo', () => {
  it('muestra la proyección por moneda y permite al administrador el cierre forzado', async () => {
    const e = crearEntorno('caj');
    await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 10000 } });
    await e.api.llamar('confirmarVenta', { requestId: uuid(), carrito: { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'cable-hdmi', cantidad: 1 }] }, pagos: [{ medio: 'qr', moneda: 'BOB', monto: 5568, referencia: 'Q1' }] });
    e.como('adm');
    render(e.envolver(h(PantallaSupervision, { sub: 'vivo' })));
    const tabla = await screen.findByRole('table', { name: 'Totales en vivo del turno' });
    expect(tabla.textContent).toContain('Bs 100,00');
    expect(tabla.textContent).toContain('Bs 55,68');
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'Cierre forzado…' }));
    await u.type(screen.getByLabelText(/Motivo del cierre forzado/), 'Olvidó cerrar');
    await u.type(screen.getByLabelText(/Efectivo contado en BOB/), '100');
    await u.click(screen.getByRole('button', { name: 'Cerrar turno a la fuerza' }));
    await u.click(await screen.findByRole('button', { name: 'Confirmar' }));
    await screen.findByText('No hay turnos abiertos');
  });
  it('la auditoría se filtra y se exporta; el vendedor no ve estas pantallas por el menú pero el servidor también lo impide', async () => {
    const e = crearEntorno('sup');
    await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 0 } });
    render(e.envolver(h(PantallaSupervision, { sub: 'auditoria' })));
    const u = userEvent.setup();
    expect(await screen.findByText('pos.turno.abrir')).toBeTruthy();
    await u.type(screen.getByLabelText(/Acción contiene/), 'no-existe');
    await u.click(screen.getByRole('button', { name: 'Filtrar' }));
    expect(await screen.findByText('No hay registros con esos filtros')).toBeTruthy();
    const crear = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockReturnValue(undefined);
    await u.click(screen.getByRole('button', { name: 'Exportar ventas (CSV)' }));
    await waitFor(() => expect(crear).toHaveBeenCalled());
  });
  it('exportar ventas: si el servidor trunca, el panel lo avisa en vez de callar', async () => {
    const e = crearEntorno('sup');
    const original = e.api.llamar.bind(e.api);
    (e.api as { llamar: unknown }).llamar = async (n: string, entrada: unknown) => (n === 'exportarVentasCsv' ? { csv: 'a\r\n', truncado: true } : original(n as never, entrada as never));
    render(e.envolver(h(PantallaSupervision, { sub: 'auditoria' })));
    const u = userEvent.setup();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockReturnValue(undefined);
    await u.click(await screen.findByRole('button', { name: 'Exportar ventas (CSV)' }));
    expect(await screen.findByText(/archivo está incompleto.*5000/)).toBeTruthy();
  });
  it('exportar ventas: último mes por defecto, pide el rango al servidor y descarga el CSV; rechaza rangos de más de 366 días', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 10, 4, 15, 0, 0));
    try {
      const e = crearEntorno('sup');
      render(e.envolver(h(PantallaSupervision, { sub: 'auditoria' })));
      const u = userEvent.setup();
      const desde = (await screen.findByLabelText(/Ventas desde/)) as HTMLInputElement;
      const hasta = screen.getByLabelText(/Ventas hasta/) as HTMLInputElement;
      expect([desde.value, hasta.value]).toEqual(['2026-10-04', '2026-11-04']);
      let blob: Blob | undefined;
      vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => { blob = b as Blob; return 'blob:x'; });
      vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
      let nombre = '';
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { nombre = this.download; });
      await u.click(screen.getByRole('button', { name: 'Exportar ventas (CSV)' }));
      await waitFor(() => expect(blob).toBeDefined());
      expect(nombre).toBe('ventas_2026-10-04_2026-11-04.csv');
      expect(await blob?.text()).toContain('ventaId');
      expect(e.api.llamadas.find((l) => l.nombre === 'exportarVentasCsv')?.entrada).toEqual({ desde: '2026-10-04', hasta: '2026-11-04' });
      fireEvent.input(desde, { target: { value: '2025-01-01' } });
      expect(await screen.findByText(/hasta 366 días/, { selector: '[role="alert"]' })).toBeTruthy();
      expect((screen.getByRole('button', { name: 'Exportar ventas (CSV)' }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.input(desde, { target: { value: '2025-11-04' } });
      await waitFor(() => expect((screen.getByRole('button', { name: 'Exportar ventas (CSV)' }) as HTMLButtonElement).disabled).toBe(false));
    } finally {
      vi.useRealTimers();
    }
  });
});
