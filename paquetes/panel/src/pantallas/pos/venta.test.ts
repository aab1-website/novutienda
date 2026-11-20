// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearEntorno, uuid, type Entorno } from '../../ayuda-pruebas.js';
import { PantallaVenta } from './venta.js';
import { PantallaAprobaciones } from './aprobaciones.js';
import { PantallaSupervision, textoAntiguedad } from './supervision.js';

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
    await u.clear(campo(/Monto que paga con este medio/));
    await u.type(campo(/Monto que paga con este medio/), '55,68');
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
    expect(screen.getByRole('button', { name: 'Cobrar' }).getAttribute('aria-disabled')).toBe('true');
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
    expect(screen.getByRole('button', { name: 'Cobrar' }).getAttribute('aria-disabled')).toBe('true');
    await u.click(screen.getByRole('button', { name: 'Solicitar aprobación' }));
    expect(await screen.findByText(/Solicitud enviada/)).toBeTruthy();
    // El supervisor la aprueba desde su pantalla.
    cleanup();
    e.como('sup');
    render(e.envolver(h(PantallaAprobaciones, { sub: 'descuentos' })));
    await u.click(await screen.findByRole('button', { name: 'Aprobar solicitud de descuento' }));
    await u.click(await screen.findByRole('button', { name: 'Sí, aprobar' }));
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
    await u.clear(campo(/Monto que paga con este medio/));
    await u.type(campo(/Monto que paga con este medio/), '20');
    await u.click(screen.getByRole('button', { name: 'Agregar otro medio' }));
    const pagos = screen.getAllByRole('group', { name: /Pago/ });
    const segundo = pagos[1] as HTMLElement;
    await u.selectOptions(within(segundo).getByLabelText('Medio'), 'qr');
    await u.clear(within(segundo).getByLabelText(/Monto que paga con este medio/));
    await u.type(within(segundo).getByLabelText(/Monto que paga con este medio/), '20');
    await u.type(within(segundo).getByLabelText(/Referencia del QR/), 'REF-77');
    expect(within(segundo).getByText(/QR registrado por sup@ejemplo.test/)).toBeTruthy();
    expect(document.querySelector('[data-prueba="restante"]')?.textContent).toBe('Bs 15,68');
    expect(screen.getByRole('button', { name: 'Confirmar cobro' }).getAttribute('aria-disabled')).toBe('true');
    await u.click(screen.getByRole('button', { name: 'Agregar otro medio' }));
    const tercero = screen.getAllByRole('group', { name: /Pago/ })[2] as HTMLElement;
    await u.selectOptions(within(tercero).getByLabelText('Medio'), 'credito');
    await u.clear(within(tercero).getByLabelText(/Monto que paga con este medio/));
    await u.type(within(tercero).getByLabelText(/Monto que paga con este medio/), '15,68');
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
    await u.clear(campo(/Monto que paga con este medio/));
    await u.type(campo(/Monto que paga con este medio/), '174');
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
    await screen.findByRole('heading', { name: 'Ingresos y egresos excepcionales' });
    await u.type(campo(/^Monto/), '150');
    expect(await screen.findByText(/mayor que el efectivo disponible/)).toBeTruthy();
    await u.clear(campo(/^Monto/));
    await u.type(campo(/^Monto/), '40');
    await u.type(campo(/^Motivo/), 'Compra de bolsas');
    await u.click(screen.getByRole('button', { name: 'Registrar' }));
    expect(await screen.findByText('Egreso registrado.')).toBeTruthy();
    expect(await screen.findByText('Compra de bolsas')).toBeTruthy();
  });

  it('la pestaña se llama «Ing. y Egr. Excepcionales», sin aria-label', async () => {
    const e = crearEntorno('caj');
    await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 0 } });
    ver(e, 'caja');
    await screen.findByRole('heading', { name: 'Ingresos y egresos excepcionales' });
    const enlace = screen.getByRole('link', { name: 'Ing. y Egr. Excepcionales' });
    expect(enlace.textContent).toBe('Ing. y Egr. Excepcionales');
    expect(enlace.getAttribute('aria-label')).toBeNull();
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
    expect(await screen.findByText('Apertura de turno')).toBeTruthy();
    await u.selectOptions(screen.getByLabelText('Acción'), 'Cierre de turno');
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

const UN_MERCADO = {
  mercados: [{ id: 'BO', nombre: 'Bolivia', monedaVenta: 'BOB', monedaBase: 'BOB', tieneTipoCambio: false }],
  monedasCaja: ['BOB'],
};

describe('supervisión: carritos abiertos', () => {
  it('sin carritos dice que no hay; con carritos los lista sin datos del cliente y el supervisor cancela con motivo', async () => {
    const e = crearEntorno('caj');
    await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 10000 } });
    e.como('sup');
    render(e.envolver(h(PantallaSupervision, { sub: 'vivo' })));
    expect(await screen.findByText('No hay carritos abiertos.')).toBeTruthy();
    cleanup();
    e.como('caj');
    const carritoId = uuid();
    await e.api.llamar('crearCarrito', { carritoId, etiqueta: 'Mostrador 1' });
    e.como('sup');
    render(e.envolver(h(PantallaSupervision, { sub: 'vivo' })));
    const tabla = await screen.findByRole('table', { name: 'Carritos abiertos' });
    expect(tabla.textContent).toMatch(/Mostrador 1/);
    for (const t of ['Carrito', 'Cajero', 'Productos', 'Unidades', 'Antigüedad']) expect(within(tabla).getByRole('columnheader', { name: new RegExp(t) })).toBeTruthy();
    expect(screen.queryByText('No hay carritos abiertos.')).toBeNull();
    expect(within(tabla).getByText('Cajero de la caja abierta')).toBeTruthy();
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'Cancelar con motivo Mostrador 1' }));
    await u.type(screen.getByLabelText(/Motivo de la cancelación de Mostrador 1/), 'Cliente ausente');
    await u.click(screen.getByRole('button', { name: 'Confirmar cancelación de Mostrador 1' }));
    expect(await screen.findByText('No hay carritos abiertos.')).toBeTruthy();
    expect(e.api.llamadas.find((l) => l.nombre === 'cancelarCarrito')?.entrada).toEqual({ carritoId, motivo: 'Cliente ausente' });
  });
  it('el administrador también los ve', async () => {
    const e = crearEntorno('caj');
    await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 0 } });
    await e.api.llamar('crearCarrito', { carritoId: uuid(), etiqueta: 'Cliente 7' });
    e.como('adm');
    render(e.envolver(h(PantallaSupervision, { sub: 'vivo' })));
    expect((await screen.findByRole('table', { name: 'Carritos abiertos' })).textContent).toMatch(/Cliente 7/);
  });
  it('el vendedor no ve la sección', async () => {
    const e = crearEntorno('caj');
    render(e.envolver(h(PantallaSupervision, { sub: 'vivo' })));
    await screen.findByText(/Cajas abiertas/);
    expect(screen.queryByText('No hay carritos abiertos.')).toBeNull();
    expect(e.api.llamadas.some((l) => l.nombre === 'carritosSupervision')).toBe(false);
  });
  it('textoAntiguedad', () => {
    expect([0, 90_000, 3_600_000 + 600_000, 90_000_000].map(textoAntiguedad)).toEqual(['menos de 1 min', '1 min', '1 h 10 min', '1 d 1 h']);
  });
});

describe('venta: mercados y monedas declarados', () => {
  it('el comercio de referencia abre turno en el orden declarado: bolivianos, dólares, pesos', async () => {
    const e = crearEntorno('caj');
    ver(e, 'terminal');
    await screen.findByRole('heading', { name: 'Abrir turno' });
    const campos = await screen.findAllByLabelText(/Efectivo inicial en/);
    const etiquetas = campos.map((x) => (x as HTMLInputElement).labels?.[0]?.textContent ?? '');
    expect(etiquetas.map((t) => /Bolivianos|Dólares|Pesos/.exec(t)?.[0])).toEqual(['Bolivianos', 'Dólares', 'Pesos']);
  });

  it('el comercio de referencia ve las dos listas de precios y las monedas de Bolivia', async () => {
    const e = crearEntorno('caj');
    await abrirTurno(e);
    expect(screen.getByLabelText('Lista de precios')).toBeTruthy();
    const monedas = [...(screen.getByLabelText('Moneda de la venta') as HTMLSelectElement).options].map((o) => o.value);
    expect(monedas).toEqual(['BOB', 'USD']);
  });

  it('un solo mercado y una sola moneda: sin selectores, apertura y caja solo en esa moneda, y cobra', async () => {
    const e = crearEntorno('caj', undefined, { comercial: UN_MERCADO, redondeo: { BOB: { tipo: 'decimales', decimales: 2, modo: 'cercano' } } });
    ver(e, 'terminal');
    const u = userEvent.setup();
    await screen.findByRole('heading', { name: 'Abrir turno' });
    expect(screen.getAllByLabelText(/Efectivo inicial en/).length).toBe(1);
    await u.type(campo(/Efectivo inicial en Bolivianos/), '100');
    await u.click(screen.getByRole('button', { name: 'Abrir turno' }));
    await screen.findByRole('heading', { name: 'Productos' });
    expect(screen.queryByLabelText('Lista de precios')).toBeNull();
    expect(screen.queryByLabelText('Moneda de la venta')).toBeNull();
    expect(screen.queryByText(/Cotización:/)).toBeNull();
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    await waitFor(() => expect(document.querySelector('[data-prueba="total"]')?.textContent).toBe('Bs 8,00'));
    await u.click(screen.getByRole('button', { name: 'Cobrar' }));
    await screen.findByRole('heading', { name: 'Cobro' });
    await u.clear(campo(/Monto que paga con este medio/));
    await u.type(campo(/Monto que paga con este medio/), '8');
    await u.click(screen.getByRole('button', { name: 'Confirmar cobro' }));
    await screen.findByRole('heading', { name: 'Venta registrada' });
    const venta = (await e.api.llamar('listarVentas', {}))[0];
    expect(venta).toMatchObject({ mercado: 'BO', moneda: 'BOB', total: 800 });
  });

  it('la caja ofrece solo las monedas declaradas', async () => {
    const e = crearEntorno('caj', undefined, { comercial: UN_MERCADO });
    await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 10000 } });
    ver(e, 'caja');
    const sel = (await screen.findByLabelText('Moneda')) as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value)).toEqual(['BOB']);
  });

  it('sin regla de redondeo avisa y no muestra precio (D21)', async () => {
    const e = crearEntorno('caj', undefined, { comercial: UN_MERCADO, redondeo: {} });
    await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 10000 } });
    ver(e, 'terminal');
    expect(await screen.findByText(/Falta la regla de redondeo de BOB/)).toBeTruthy();
    expect((await screen.findAllByText('Sin regla de redondeo')).length).toBeGreaterThan(0);
    expect((screen.getByRole('button', { name: 'Agregar Cable HDMI 2 m' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('un mercado sin cotización avisa y no deja agregar en su moneda de venta', async () => {
    const e = crearEntorno('caj');
    e.api.estado.cotizaciones = { ...e.api.estado.cotizaciones, BO: null };
    await abrirTurno(e);
    expect(await screen.findByText(/No hay una cotización utilizable/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Agregar Cable HDMI 2 m' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('un mercado declarado sin tipo de cambio cobra en su moneda base con el monto redondeado que acepta el servidor', async () => {
    const comercial = {
      mercados: [{ id: 'BO', nombre: 'Bolivia', monedaVenta: 'BOB', monedaBase: 'USD', tieneTipoCambio: false }],
      monedasCaja: ['BOB', 'USD'],
    };
    const e = crearEntorno('caj', undefined, { comercial, redondeo: { BOB: { tipo: 'multiplo', multiplo: 5, modo: 'cercano' } } });
    await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 10000, USD: 10000 } });
    ver(e, 'terminal');
    const u = userEvent.setup();
    await screen.findByRole('heading', { name: 'Productos' });
    await u.selectOptions(screen.getByLabelText('Moneda de la venta'), 'USD');
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    // 8,00 redondeado al múltiplo de 5 de la moneda de venta: 10,00 (no 8,00).
    await waitFor(() => expect(document.querySelector('[data-prueba="total"]')?.textContent).toMatch(/10,00/));
    await u.click(screen.getByRole('button', { name: 'Cobrar' }));
    await screen.findByRole('heading', { name: 'Cobro' });
    await u.clear(campo(/Monto que paga con este medio/));
    await u.type(campo(/Monto que paga con este medio/), '10');
    await u.click(screen.getByRole('button', { name: 'Confirmar cobro' }));
    await screen.findByRole('heading', { name: 'Venta registrada' });
    const venta = (await e.api.llamar('listarVentas', {}))[0];
    expect(venta).toMatchObject({ mercado: 'BO', moneda: 'USD', total: 1000 });
  });

  it('al cambiar de mercado con el carrito cargado, las líneas se conservan y se recalculan al precio del otro mercado', async () => {
    const e = crearEntorno('caj');
    await abrirTurno(e);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    const total = (): string => document.querySelector('[data-prueba="total"]')?.textContent ?? '';
    await waitFor(() => expect(total()).not.toBe(''));
    const enBolivia = total();
    await u.selectOptions(screen.getByLabelText('Lista de precios'), 'AR');
    await waitFor(() => expect(total()).not.toBe(enBolivia));
    expect(total()).toBe('ARS 9.000,00');
    expect(screen.getByRole('button', { name: 'Cobrar' })).toBeTruthy();
  });

  it('sin monedas de caja declaradas, el turno no se abre y avisa', async () => {
    const e = crearEntorno('caj', undefined, { comercial: { ...UN_MERCADO, monedasCaja: [] } });
    ver(e, 'terminal');
    expect(await screen.findByText(/no tiene monedas de caja declaradas/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Abrir turno' })).toBeNull();
  });
});

describe('cierre y supervisión: orden de monedas declarado por el comercio', () => {
  const APERTURA = { ARS: 100000, USD: 2000, BOB: 10000 };
  const leyendas = (): string[] => [...document.querySelectorAll('legend')].map((l) => l.textContent ?? '');
  const filas = (tabla: HTMLElement): string[] => [...tabla.querySelectorAll('tbody th')].map((t) => t.textContent ?? '');

  it('el cierre de turno del comercio de referencia lista bolivianos, dólares, pesos, aunque la apertura venga en otro orden', async () => {
    const e = crearEntorno('caj');
    await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: APERTURA });
    ver(e, 'cierre');
    await screen.findByRole('heading', { name: 'Cierre de turno' });
    expect(leyendas()).toEqual(['BOB', 'USD', 'ARS']);
    const u = userEvent.setup();
    await u.type(campo(/Efectivo contado en BOB/), '100');
    await u.type(campo(/Efectivo contado en USD/), '20');
    await u.type(campo(/Efectivo contado en ARS/), '900');
    expect(document.querySelector('[data-prueba="diferencia-ARS"]')?.textContent).toContain('(faltante)');
    await u.click(screen.getByRole('button', { name: 'Cerrar turno' }));
    await u.click(await screen.findByRole('button', { name: 'Sí, cerrar turno' }));
    await screen.findByRole('heading', { name: 'Turno cerrado' });
    expect(filas(screen.getByRole('table', { name: 'Arqueo del turno cerrado' }))).toEqual(['BOB', 'USD', 'ARS']);
  });

  it('la supervisión en vivo del comercio de referencia muestra el mismo orden y los mismos montos que el cierre', async () => {
    const e = crearEntorno('caj');
    await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: APERTURA });
    e.como('adm');
    render(e.envolver(h(PantallaSupervision, { sub: 'vivo' })));
    const tabla = await screen.findByRole('table', { name: 'Totales en vivo del turno' });
    expect(filas(tabla)).toEqual(['BOB', 'USD', 'ARS']);
    const celdas = [...tabla.querySelectorAll('tbody tr')].map((f) => f.querySelector('td')?.textContent);
    expect(celdas).toEqual(['Bs 100,00', 'USD 20,00', 'ARS 1.000,00']);
    cleanup();
    e.como('caj');
    ver(e, 'cierre');
    await screen.findByRole('heading', { name: 'Cierre de turno' });
    const esperados = [...document.querySelectorAll('fieldset')].map((f) => f.querySelectorAll('dd')[1]?.textContent);
    expect(esperados).toEqual(celdas);
  });

  it('un comercio con otro orden declarado lo ve igual en cierre y supervisión', async () => {
    const comercial = { ...UN_MERCADO, monedasCaja: ['USD', 'BOB'] };
    const e = crearEntorno('caj', undefined, { comercial });
    await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 10000, USD: 2000 } });
    ver(e, 'cierre');
    await screen.findByRole('heading', { name: 'Cierre de turno' });
    expect(leyendas()).toEqual(['USD', 'BOB']);
    cleanup();
    e.como('adm');
    render(e.envolver(h(PantallaSupervision, { sub: 'vivo' })));
    const tabla = await screen.findByRole('table', { name: 'Totales en vivo del turno' });
    expect(filas(tabla)).toEqual(['USD', 'BOB']);
  });

  it('un comercio de una sola moneda ve solo esa moneda en cierre y supervisión', async () => {
    const e = crearEntorno('caj', undefined, { comercial: UN_MERCADO });
    await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 10000 } });
    ver(e, 'cierre');
    await screen.findByRole('heading', { name: 'Cierre de turno' });
    expect(leyendas()).toEqual(['BOB']);
    cleanup();
    e.como('adm');
    render(e.envolver(h(PantallaSupervision, { sub: 'vivo' })));
    const tabla = await screen.findByRole('table', { name: 'Totales en vivo del turno' });
    expect(filas(tabla)).toEqual(['BOB']);
    expect(tabla.textContent).toContain('Bs 100,00');
  });
});
