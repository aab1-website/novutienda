// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, render, screen, waitFor, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearEntorno, uuid, type Entorno } from '../../ayuda-pruebas.js';
import { ProveedorGuardia } from '../../ui/guardia.js';
import { montosQueSiguenAlRestante, type FilaPago } from './pagos.js';
import { PantallaVenta } from './venta.js';
import { VentaCobro } from './venta-cobro.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const campo = (re: RegExp): HTMLElement => screen.getByLabelText(re);
const boton = (nombre: string | RegExp): HTMLElement => screen.getByRole('button', { name: nombre });
const ver = (e: Entorno, sub: string): void => void render(h(ProveedorGuardia, null, e.envolver(h(PantallaVenta, { sub }))));

describe('7.4.2: el cierre lee el turno por su cuenta', () => {
  /** Una venta del cajero con anulación solicitada; el supervisor la aprueba desde otra ventana y el cajero cierra. */
  async function preparar(): Promise<{ e: Entorno; ventaId: string }> {
    const e = crearEntorno('caj');
    const ventaId = uuid();
    await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 10000 } });
    await e.api.llamar('confirmarVenta', { requestId: ventaId, carrito: { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'cable-hdmi', cantidad: 1 }] }, pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 5568 }] });
    await e.api.llamar('solicitarAnulacion', { ventaId, motivo: 'Error de producto' });
    return { e, ventaId };
  }
  const anularPorFuera = async (e: Entorno, ventaId: string): Promise<void> => {
    e.como('sup');
    await e.api.llamar('aprobarAnulacion', { ventaId, motivo: 'Verificado' });
    e.como('caj');
  };

  it('una anulación con reembolso hecha por fuera impide el cierre, avisa y no pierde lo contado', async () => {
    const { e, ventaId } = await preparar();
    ver(e, 'cierre');
    const u = userEvent.setup();
    await screen.findByRole('heading', { name: 'Cierre de turno' });
    await u.type(campo(/Efectivo contado en BOB/), '100');
    await waitFor(() => expect(screen.queryByText('Actualizando…')).toBeNull());
    await anularPorFuera(e, ventaId);
    await u.click(boton('Cerrar turno'));
    await u.click(await screen.findByRole('button', { name: 'Sí, cerrar turno' }));
    expect(await screen.findByText(/El efectivo esperado cambió/)).toBeTruthy();
    expect((campo(/Efectivo contado en BOB/) as HTMLInputElement).value).toBe('100');
    await waitFor(() => expect(screen.queryByText('Bs 155,68')).toBeNull());
    expect((await e.api.llamar('turnoActual', {}))?.estado).toBe('abierto');
    // Revisado el valor nuevo, se confirma y cierra.
    await u.click(boton('Cerrar turno'));
    await u.click(await screen.findByRole('button', { name: 'Sí, cerrar turno' }));
    await screen.findByRole('heading', { name: 'Turno cerrado' });
  });

  it('«Actualizar» refleja el cambio sin borrar lo contado', async () => {
    const { e, ventaId } = await preparar();
    ver(e, 'cierre');
    const u = userEvent.setup();
    await screen.findByRole('heading', { name: 'Cierre de turno' });
    await u.type(campo(/Efectivo contado en BOB/), '90');
    expect(screen.getByText('Bs 155,68')).toBeTruthy();
    await anularPorFuera(e, ventaId);
    await u.click(boton('Actualizar'));
    await waitFor(() => expect(screen.queryByText('Bs 155,68')).toBeNull());
    expect((campo(/Efectivo contado en BOB/) as HTMLInputElement).value).toBe('90');
  });

  it('sin cambios, cierra en un solo paso', async () => {
    const { e } = await preparar();
    ver(e, 'cierre');
    const u = userEvent.setup();
    await screen.findByRole('heading', { name: 'Cierre de turno' });
    await u.type(campo(/Efectivo contado en BOB/), '100');
    await waitFor(() => expect(screen.queryByText('Actualizando…')).toBeNull());
    await u.click(boton('Cerrar turno'));
    await u.click(await screen.findByRole('button', { name: 'Sí, cerrar turno' }));
    await screen.findByRole('heading', { name: 'Turno cerrado' });
    expect(screen.queryByText(/El efectivo esperado cambió/)).toBeNull();
  });
});

describe('7.1.8: teléfono del cliente', () => {
  it('sin nombre y con teléfono inválido, «Cobrar» queda bloqueado con el motivo', async () => {
    const e = crearEntorno('caj');
    await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 10000 } });
    ver(e, 'terminal');
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    await u.type(campo(/Teléfono del cliente \(opcional, exige el nombre\)/), '70012345');
    expect((await screen.findAllByText('Escriba el nombre del cliente: el teléfono se guarda con él.')).length).toBeGreaterThan(0);
    expect(boton('Cobrar').getAttribute('aria-disabled')).toBe('true');
    await u.type(campo(/^Cliente/), 'Ana');
    await waitFor(() => expect(boton('Cobrar').getAttribute('aria-disabled')).toBeNull());
    await u.clear(campo(/Teléfono del cliente/));
    await u.type(campo(/Teléfono del cliente/), '12345');
    expect((await screen.findAllByText('El teléfono debe tener de 6 a 15 dígitos.')).length).toBeGreaterThan(0);
    expect(boton('Cobrar').getAttribute('aria-disabled')).toBe('true');
    await u.clear(campo(/Teléfono del cliente/));
    await u.type(campo(/Teléfono del cliente/), '+591 700-12345');
    await waitFor(() => expect(boton('Cobrar').getAttribute('aria-disabled')).toBeNull());
  });
});

describe('7.1.6: el restante sigue a la última fila no escrita', () => {
  const fila = (id: string, monto: string): FilaPago => ({ id, medio: 'efectivo', monto, recibido: '', referencia: '' });
  it('con un total de 100 y 60 en efectivo, la otra fila queda en 40; lo escrito no se pisa', () => {
    const filas = [fila('a', '60'), fila('b', '100,00')];
    expect(montosQueSiguenAlRestante(filas, new Set(['a']), 10000).map((f) => f.monto)).toEqual(['60', '40,00']);
    expect(montosQueSiguenAlRestante(filas, new Set(['a', 'b']), 10000)).toBe(filas);
    expect(montosQueSiguenAlRestante([fila('a', '150'), fila('b', '40,00')], new Set(['a']), 10000)[1]?.monto).toBe('');
  });

  it('en pantalla: el QR toma el restante al escribir 60 en efectivo', async () => {
    const e = crearEntorno('caj');
    const config = await e.api.llamar('leerConfigPos', {});
    const datos = { mercado: 'BO', moneda: 'BOB', config, total: 10000, carrito: { mercado: 'BO', moneda: 'BOB', lineas: [], totalMostrado: 10000 }, aprobacionId: undefined, requestId: uuid() } as unknown as Parameters<typeof VentaCobro>[0]['datos'];
    render(e.envolver(h(VentaCobro, { datos, volver: () => undefined, alVender: () => undefined })));
    const u = userEvent.setup();
    await u.click(boton('Agregar otro medio'));
    const campos = (): HTMLInputElement[] => screen.getAllByLabelText(/Monto que paga con este medio/) as HTMLInputElement[];
    await waitFor(() => expect(campos()).toHaveLength(2));
    await u.clear(campos()[0] as HTMLElement);
    await u.type(campos()[0] as HTMLElement, '60');
    await waitFor(() => expect(campos()[1]?.value).toBe('40,00'));
    expect(campos()[0]?.value).toBe('60');
  });

  it('el QR dice que la referencia es el código del banco, no el monto', async () => {
    const e = crearEntorno('caj');
    const config = await e.api.llamar('leerConfigPos', {});
    const datos = { mercado: 'BO', moneda: 'BOB', config, total: 10000, carrito: { mercado: 'BO', moneda: 'BOB', lineas: [], totalMostrado: 10000 }, aprobacionId: undefined, requestId: uuid() } as unknown as Parameters<typeof VentaCobro>[0]['datos'];
    render(e.envolver(h(VentaCobro, { datos, volver: () => undefined, alVender: () => undefined })));
    const u = userEvent.setup();
    await u.selectOptions(screen.getByLabelText('Medio'), 'qr');
    expect(await screen.findByText('Código que muestra el banco, no el monto')).toBeTruthy();
  });
});

describe('7.3.1: Ing. y Egr. Excepcionales dice por qué no registra', () => {
  it('con «20 Bs» no registra y muestra el motivo; con «20» registra', async () => {
    const e = crearEntorno('caj');
    await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 10000 } });
    ver(e, 'caja');
    const u = userEvent.setup();
    await screen.findByRole('heading', { name: 'Ingresos y egresos excepcionales' });
    expect(screen.getByText('Escriba el monto.')).toBeTruthy();
    await u.type(campo(/^Monto/), '20 Bs');
    await u.type(campo(/^Motivo/), 'Bolsas');
    expect((await screen.findAllByText('El monto «20 Bs» no es válido: escriba solo el número, por ejemplo 20 o 20,50.')).length).toBeGreaterThan(0);
    await u.click(boton('Registrar'));
    expect(screen.queryByText('Egreso registrado.')).toBeNull();
    await u.clear(campo(/^Monto/));
    await u.type(campo(/^Monto/), '0');
    expect((await screen.findAllByText('El monto debe ser mayor a cero.')).length).toBeGreaterThan(0);
    await u.clear(campo(/^Monto/));
    await u.type(campo(/^Monto/), '20');
    await u.click(boton('Registrar'));
    expect(await screen.findByText('Egreso registrado.')).toBeTruthy();
  });
});

describe('7.2.5: el resultado de la solicitud se avisa', () => {
  async function pedir(e: Entorno): Promise<ReturnType<typeof userEvent.setup>> {
    await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 10000 } });
    ver(e, 'terminal');
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    await u.type(campo(/Descuento \(monto\)/), '10');
    await u.type(campo(/Motivo del descuento/), 'Cliente frecuente');
    await u.click(await screen.findByRole('button', { name: 'Solicitar aprobación' }));
    expect(await screen.findByText(/Esperando la aprobación/)).toBeTruthy();
    return u;
  }
  const resolver = async (e: Entorno, decision: 'aprobar' | 'rechazar', motivo?: string): Promise<void> => {
    e.como('sup');
    const pendiente = (await e.api.llamar('listarAprobaciones', { estado: 'pendiente' }))[0];
    await e.api.llamar('resolverAprobacion', { aprobacionId: pendiente?.aprobacionId ?? '', decision, ...(motivo !== undefined ? { motivo } : {}) });
    e.como('caj');
  };

  it('aprobada: aviso de éxito', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const e = crearEntorno('caj');
    await pedir(e);
    await resolver(e, 'aprobar');
    await vi.advanceTimersByTimeAsync(4000);
    expect(await screen.findByText('El supervisor aprobó su solicitud de descuento.')).toBeTruthy();
  });

  it('rechazada: aviso de error con el motivo', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const e = crearEntorno('caj');
    await pedir(e);
    await resolver(e, 'rechazar', 'Supera el tope');
    await vi.advanceTimersByTimeAsync(4000);
    expect(await screen.findByText('El supervisor rechazó su solicitud de descuento. Motivo: Supera el tope')).toBeTruthy();
  });

  it('no encontrada: avisa que la solicitud ya no está pendiente', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const e = crearEntorno('caj');
    await pedir(e);
    const original = e.api.llamar.bind(e.api);
    (e.api as { llamar: unknown }).llamar = async (n: string, entrada: unknown) => {
      if (n === 'listarAprobaciones') return [];
      return (original as (n: string, x: unknown) => Promise<unknown>)(n, entrada);
    };
    await vi.advanceTimersByTimeAsync(4000);
    expect(await screen.findByText('La solicitud ya no está pendiente.')).toBeTruthy();
  });

  it('una espera agotada se reanuda al volver a la pestaña', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const e = crearEntorno('caj');
    await pedir(e);
    await vi.advanceTimersByTimeAsync(4000 * 151);
    expect(await screen.findByText(/ya no se consulta sola/)).toBeTruthy();
    await resolver(e, 'aprobar');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(4000);
    expect(await screen.findByText('El supervisor aprobó su solicitud de descuento.')).toBeTruthy();
  });

  it('al volver a la pestaña consulta en el acto, sin esperar los 4 s', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const e = crearEntorno('caj');
    await pedir(e);
    await resolver(e, 'aprobar');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(await screen.findByText('El supervisor aprobó su solicitud de descuento.')).toBeTruthy();
  });
});

describe('7.1.3: al elegir series, el foco va al selector', () => {
  it('un producto con serie lleva el foco al campo de series', async () => {
    const e = crearEntorno('caj');
    await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 10000 } });
    ver(e, 'terminal');
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Agregar Televisor 55 pulgadas' }));
    const zona = await waitFor(() => {
      const z = document.querySelector('[data-series-de]');
      if (z === null) throw new Error('sin selector');
      return z as HTMLElement;
    });
    await waitFor(() => expect(zona.contains(document.activeElement) && document.activeElement !== zona).toBe(true));
  });
});

describe('9.1.2: sin turno se ve el catálogo, no se vende', () => {
  it('muestra productos y «Oculto» con un conteo abierto, sin botones «Agregar»', async () => {
    const e = crearEntorno('sup');
    await e.api.llamar('abrirConteo', { operacionId: uuid(), conteoId: 'conteo-tienda', ubicacionId: 'tienda' });
    e.como('caj');
    ver(e, 'terminal');
    await screen.findByRole('heading', { name: 'Abrir turno' });
    expect(await screen.findByText('Abra turno para vender.')).toBeTruthy();
    const lista = await screen.findByRole('heading', { name: 'Productos (solo consulta)' });
    expect(lista).toBeTruthy();
    expect(await screen.findByText('Cable HDMI 2 m')).toBeTruthy();
    expect(screen.getAllByRole('img', { name: 'Oculto mientras hay un conteo abierto' }).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/Tienda: \d/);
    expect(screen.queryByRole('button', { name: /^Agregar/ })).toBeNull();
    expect(within(document.body).queryByRole('group', { name: 'Carrito' })).toBeNull();
  });
});
