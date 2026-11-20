// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, render, screen, waitFor, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearEntorno, uuid, type Entorno } from '../../ayuda-pruebas.js';
import { ProveedorGuardia } from '../../ui/guardia.js';
import { ErrorApi } from '../../api/errores.js';
import { marcaDe } from '../../api/marca.js';
import { AVISO_COBRO_CONFLICTO, AVISO_CONFLICTO, AVISO_NO_GUARDADO } from './carritos.js';
import { PantallaVenta } from './venta.js';
import { avisosAlRetomar } from './venta-terminal.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const pantalla = (e: Entorno, sub: string) => h(ProveedorGuardia, null, e.envolver(h(PantallaVenta, { sub })));
const boton = (nombre: string | RegExp): HTMLElement => screen.getByRole('button', { name: nombre });
const campo = (re: RegExp): HTMLElement => screen.getByLabelText(re);

async function conTurno(e: Entorno): Promise<ReturnType<typeof render>> {
  await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 10000 } });
  const r = render(pantalla(e, 'terminal'));
  await screen.findByRole('heading', { name: 'Productos' });
  await screen.findByRole('region', { name: 'Carritos abiertos' });
  return r;
}
const guardado = (): Promise<HTMLElement> => waitFor(() => { expect(screen.getByText('Guardado')).toBeTruthy(); return screen.getByText('Guardado'); }, { timeout: 4000 });

describe('carritos guardados en el servidor', () => {
  it('al entrar crea «Cliente 1» y guarda solo, sin botón de guardar', async () => {
    const e = crearEntorno('caj');
    const u = userEvent.setup();
    await conTurno(e);
    expect(screen.getByRole('button', { name: /^Cliente 1 · 0 productos/ })).toBeTruthy();
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    await waitFor(async () => expect((await e.api.llamar('misCarritos', {}))[0]?.contenido?.lineas).toHaveLength(1), { timeout: 4000 });
    await guardado();
    expect(screen.getByRole('button', { name: /^Cliente 1 · 1 producto$/ })).toBeTruthy();
  });

  it('dos carritos: cada uno conserva su contenido al cambiar entre ellos', async () => {
    const e = crearEntorno('caj');
    const u = userEvent.setup();
    await conTurno(e);
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    await u.click(boton('Nuevo carrito'));
    await screen.findByText('El carrito está vacío');
    expect(screen.getByRole('button', { name: /^Cliente 2 · 0 productos/ })).toBeTruthy();
    await u.click(await screen.findByRole('button', { name: 'Agregar Parlante portátil' }));
    await u.click(screen.getByRole('button', { name: /^Cliente 1 · 1 producto/ }));
    const grupo = await screen.findByRole('group', { name: 'Carrito' });
    expect(await within(grupo).findByText('Cable HDMI 2 m')).toBeTruthy();
    expect(within(grupo).queryByText('Parlante portátil')).toBeNull();
    await u.click(screen.getByRole('button', { name: /^Cliente 2 · 1 producto/ }));
    expect(await within(await screen.findByRole('group', { name: 'Carrito' })).findByText('Parlante portátil')).toBeTruthy();
    expect(await e.api.llamar('misCarritos', {})).toHaveLength(2);
  });

  it('si otra ventana cambió el carrito, se toma su versión y se avisa', async () => {
    const e = crearEntorno('caj');
    const u = userEvent.setup();
    await conTurno(e);
    const k = (await e.api.llamar('misCarritos', {}))[0];
    if (k === undefined) throw new Error('sin carrito');
    await e.api.llamar('guardarCarrito', { carritoId: k.carritoId, version: k.version, etiqueta: 'Mostrador' });
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    expect(await screen.findByText(AVISO_CONFLICTO, undefined, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Mostrador/ })).toBeTruthy();
  });

  it('con 10 carritos abiertos «Nuevo carrito» queda deshabilitado y dice por qué', async () => {
    const e = crearEntorno('caj');
    await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 10000 } });
    for (let i = 0; i < 10; i++) await e.api.llamar('crearCarrito', { carritoId: uuid() });
    render(pantalla(e, 'terminal'));
    await screen.findByRole('region', { name: 'Carritos abiertos' });
    expect(boton('Nuevo carrito').getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(/Hay 10 carritos abiertos/)).toBeTruthy();
  });

  it('cancelar pide el motivo, sin ventanas del navegador, y pasa a otro carrito', async () => {
    const e = crearEntorno('caj');
    const confirmar = vi.spyOn(window, 'confirm');
    const u = userEvent.setup();
    await conTurno(e);
    await u.click(boton('Nuevo carrito'));
    await screen.findByRole('button', { name: /^Cliente 2/ });
    await u.click(boton('Cancelar carrito Cliente 2'));
    expect(boton('Confirmar cancelación de Cliente 2').getAttribute('aria-disabled')).toBe('true');
    await u.type(campo(/Motivo de la cancelación/), 'El cliente se fue');
    await u.click(boton('Confirmar cancelación de Cliente 2'));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Cliente 2/ })).toBeNull());
    expect(screen.getByRole('button', { name: /^Cliente 1/ })).toBeTruthy();
    expect(await e.api.llamar('misCarritos', {})).toHaveLength(1);
    expect(confirmar).not.toHaveBeenCalled();
  });

  it('renombrar cambia la etiqueta y el aviso de privacidad se ve', async () => {
    const e = crearEntorno('caj');
    const u = userEvent.setup();
    await conTurno(e);
    expect(screen.getByText('No escriba datos personales del cliente en el nombre del carrito.')).toBeTruthy();
    await u.click(boton('Renombrar Cliente 1'));
    await u.clear(campo(/Nombre del carrito/));
    await u.type(campo(/Nombre del carrito/), 'Mostrador');
    await u.click(boton('Guardar nombre'));
    expect(await screen.findByRole('button', { name: /^Mostrador/ })).toBeTruthy();
    expect((await e.api.llamar('misCarritos', {}))[0]?.etiqueta).toBe('Mostrador');
  });

  it('cobrar cierra el carrito con su id como venta y pasa a otro abierto', async () => {
    const e = crearEntorno('caj');
    const u = userEvent.setup();
    await conTurno(e);
    await u.click(boton('Nuevo carrito'));
    await screen.findByRole('button', { name: /^Cliente 2/ });
    await u.click(screen.getByRole('button', { name: /^Cliente 1/ }));
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    const [k1] = await e.api.llamar('misCarritos', {});
    await u.click(boton('Cobrar'));
    await u.click(await screen.findByRole('button', { name: 'Confirmar cobro' }));
    await screen.findByRole('heading', { name: 'Venta registrada' });
    const venta = (await e.api.llamar('listarVentas', {}))[0];
    expect(venta?.ventaId).toBe(k1?.carritoId);
    await u.click(boton('Nueva venta'));
    await screen.findByRole('heading', { name: 'Productos' });
    expect(screen.queryByRole('button', { name: /^Cliente 1/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Cliente 2/ })).toBeTruthy();
    expect(await e.api.llamar('misCarritos', {})).toHaveLength(1);
  });

  it('al retomar avisa si un producto ya no está activo', async () => {
    const e = crearEntorno('caj');
    await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 10000 } });
    const k = await e.api.llamar('crearCarrito', { carritoId: uuid() });
    await e.api.llamar('guardarCarrito', { carritoId: k.carritoId, version: k.version, contenido: { mercadoId: 'BO', moneda: 'BOB', lineas: [{ productoId: 'producto-que-no-existe', almacenId: 'tienda', cantidad: 1, series: [] }] } });
    render(pantalla(e, 'terminal'));
    expect(await screen.findByText(/ya no está activo/)).toBeTruthy();
  });
});

describe('cierre de turno con carritos abiertos', () => {
  it('lista los carritos, bloquea el cierre y deja retomarlos o cancelarlos con motivo', async () => {
    const e = crearEntorno('caj');
    const u = userEvent.setup();
    await conTurno(e);
    await u.click(boton('Nuevo carrito'));
    await screen.findByRole('button', { name: /^Cliente 2/ });
    cleanup();
    render(pantalla(e, 'cierre'));
    const region = await screen.findByRole('region', { name: 'Carritos abiertos' });
    expect(within(region).getByText('Cliente 1')).toBeTruthy();
    expect(within(region).getByText('Cliente 2')).toBeTruthy();
    expect(screen.getAllByText('Hay 2 carritos abiertos: cóbrelos o cancélelos antes de cerrar la caja.').length).toBeGreaterThan(0);
    expect((boton('Cerrar turno') as HTMLButtonElement).disabled).toBe(true);
    await u.click(within(region).getByRole('button', { name: 'Cancelar con motivo Cliente 1' }));
    await u.type(campo(/Motivo de la cancelación/), 'Cliente se fue');
    await u.click(boton('Confirmar cancelación de Cliente 1'));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Carritos abiertos' })).queryByText('Cliente 1')).toBeNull());
    await u.click(screen.getByRole('button', { name: 'Cancelar con motivo Cliente 2' }));
    await u.type(campo(/Motivo de la cancelación/), 'Cliente se fue');
    await u.click(boton('Confirmar cancelación de Cliente 2'));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Carritos abiertos' })).toBeNull());
    await u.type(campo(/Efectivo contado en BOB/), '100');
    await waitFor(() => expect((boton('Cerrar turno') as HTMLButtonElement).disabled).toBe(false));
  });

  it('«Retomar» abre ese carrito en el terminal', async () => {
    const e = crearEntorno('caj');
    const u = userEvent.setup();
    await conTurno(e);
    await u.click(boton('Nuevo carrito'));
    await screen.findByRole('button', { name: /^Cliente 2/ });
    cleanup();
    render(pantalla(e, 'cierre'));
    await u.click(await screen.findByRole('button', { name: 'Retomar Cliente 1' }));
    expect(window.location.hash).toBe('#/venta/terminal');
  });

  it('«Retomar» deja ese carrito como el activo del terminal', async () => {
    const e = crearEntorno('caj');
    const u = userEvent.setup();
    await conTurno(e);
    await u.click(boton('Nuevo carrito'));
    await screen.findByRole('button', { name: /^Cliente 2/ });
    cleanup();
    const r = render(pantalla(e, 'cierre'));
    await u.click(await screen.findByRole('button', { name: 'Retomar Cliente 2' }));
    // El enrutador cambia de pestaña con el hash; aquí se hace a mano, con la misma pantalla de venta montada.
    r.rerender(pantalla(e, 'terminal'));
    await screen.findByRole('heading', { name: 'Productos' });
    expect((await screen.findByRole('button', { name: /^Cliente 2/ })).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /^Cliente 1/ }).getAttribute('aria-pressed')).toBe('false');
  });

  it('si el servidor rechaza el cierre por carritos abiertos que la pantalla no vio, muestra los suyos', async () => {
    const e = crearEntorno('caj');
    const u = userEvent.setup();
    await conTurno(e);
    cleanup();
    const real = e.api.llamar.bind(e.api);
    // La lista de la pantalla llega vacía (el carrito se abrió desde otra ventana después); el cierre lo rechaza.
    vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, x: unknown) => (n === 'misCarritos' ? Promise.resolve([]) : real(n as never, x as never))) as never);
    render(pantalla(e, 'cierre'));
    await u.type(await screen.findByLabelText(/Efectivo contado en BOB/), '100');
    await u.click(boton('Cerrar turno'));
    await u.click(await screen.findByRole('button', { name: 'Sí, cerrar turno' }));
    const region = await screen.findByRole('region', { name: 'Carritos abiertos' });
    expect(within(region).getByText('Cliente 1')).toBeTruthy();
    expect(screen.getAllByText('Hay 1 carrito abierto: cóbrelos o cancélelos antes de cerrar la caja.').length).toBeGreaterThan(0);
  });

  it('la barra y el cierre cuentan líneas: dos unidades del mismo producto son «1 producto»', async () => {
    const e = crearEntorno('caj');
    const u = userEvent.setup();
    await conTurno(e);
    const agregar = await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' });
    await u.click(agregar);
    await u.click(agregar);
    await guardado();
    expect(screen.getByRole('button', { name: /^Cliente 1 · 1 producto$/ })).toBeTruthy();
    cleanup();
    render(pantalla(e, 'cierre'));
    const region = await screen.findByRole('region', { name: 'Carritos abiertos' });
    expect(within(region).getByText('1 producto')).toBeTruthy();
  });
});

describe('carritos: fallos de guardado', () => {
  const sinRed = (e: Entorno, estado: { falla: boolean }): void => {
    const real = e.api.llamar.bind(e.api);
    vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, x: unknown) =>
      n === 'guardarCarrito' && estado.falla ? Promise.reject(new ErrorApi('unavailable', 'Sin conexión')) : real(n as never, x as never)) as never);
  };

  it('con error de red dice «Sin guardar, reintentando», no deja cambiar de carrito y al volver la red guarda solo', async () => {
    const e = crearEntorno('caj');
    const u = userEvent.setup();
    await conTurno(e);
    const red = { falla: true };
    sinRed(e, red);
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    expect(await screen.findByText('Sin guardar, reintentando', undefined, { timeout: 4000 })).toBeTruthy();
    await u.click(boton('Nuevo carrito'));
    expect(await screen.findByText(AVISO_NO_GUARDADO)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Cliente 2/ })).toBeNull();
    expect(await e.api.llamar('misCarritos', {})).toHaveLength(1);
    red.falla = false;
    await screen.findByText('Guardado', undefined, { timeout: 6000 });
    expect((await e.api.llamar('misCarritos', {}))[0]?.contenido?.lineas).toHaveLength(1);
  }, 20_000);

  it('«Cobrar» no avanza si otra ventana cambió el carrito: se queda en el carrito con el aviso de conflicto', async () => {
    const e = crearEntorno('caj');
    const u = userEvent.setup();
    await conTurno(e);
    const k = (await e.api.llamar('misCarritos', {}))[0];
    if (k === undefined) throw new Error('sin carrito');
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    // «Otra ventana» guarda antes de que pasen los 0,6 s del guardado propio.
    await e.api.llamar('guardarCarrito', { carritoId: k.carritoId, version: k.version, etiqueta: 'Mostrador' });
    await u.click(boton('Cobrar'));
    expect(await screen.findByText(AVISO_COBRO_CONFLICTO)).toBeTruthy();
    expect(screen.getByText(AVISO_CONFLICTO)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirmar cobro' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Mostrador/ })).toBeTruthy();
    expect(e.api.llamadas.some((l) => l.nombre === 'confirmarVenta')).toBe(false);
  });

  it('si un guardado ya iba en vuelo y resulta en conflicto, «Cobrar» tampoco avanza', async () => {
    const e = crearEntorno('caj');
    const u = userEvent.setup();
    await conTurno(e);
    const real = e.api.llamar.bind(e.api);
    let soltar: (() => void) | undefined;
    let enVuelo = false;
    vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, x: unknown) => {
      if (n !== 'guardarCarrito' || enVuelo) return real(n as never, x as never);
      enVuelo = true;
      return new Promise((_ok, no) => {
        soltar = () => {
          void real('misCarritos' as never, {} as never).then((ls) => no(new ErrorApi('failed-precondition', 'Conflicto', { codigo: 'carrito-conflicto', carrito: (ls as { carritoId: string }[])[0] as never })));
        };
      });
    }) as never);
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    await waitFor(() => expect(enVuelo).toBe(true), { timeout: 4000 });
    await u.click(boton('Cobrar'));
    soltar?.();
    expect(await screen.findByText(AVISO_COBRO_CONFLICTO)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirmar cobro' })).toBeNull();
  }, 15_000);

  it.each([
    ['cobrado', async (e: Entorno, id: string) => { await e.api.llamar('confirmarVenta', { requestId: id, carritoId: id, carritoVersion: (await e.api.llamar('misCarritos', {}))[0]?.version ?? 1, carrito: { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'cable-hdmi', cantidad: 1 }] }, pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 5568 }] }); }],
    ['cancelado', async (e: Entorno, id: string) => { await e.api.llamar('cancelarCarrito', { carritoId: id, motivo: 'Otra ventana' }); }],
  ])('«Cobrar» no avanza si el carrito ya fue %s desde otra ventana', async (_n, accion) => {
    const e = crearEntorno('caj');
    const u = userEvent.setup();
    await conTurno(e);
    const k = (await e.api.llamar('misCarritos', {}))[0];
    if (k === undefined) throw new Error('sin carrito');
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    await guardado();
    await accion(e, k.carritoId);
    // Un cambio nuevo queda pendiente: «Cobrar» lo guarda primero y el servidor dice que el carrito ya no está abierto.
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    await u.click(await screen.findByRole('button', { name: 'Cobrar' }));
    await waitFor(() => expect(screen.queryByText(/ya no está abierto/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Confirmar cobro' })).toBeNull();
  }, 15_000);

  it('un conflicto al confirmar el cobro vuelve al carrito con la versión vigente', async () => {
    const e = crearEntorno('caj');
    const u = userEvent.setup();
    await conTurno(e);
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    await u.click(boton('Cobrar'));
    await screen.findByRole('button', { name: 'Confirmar cobro' });
    const k = (await e.api.llamar('misCarritos', {}))[0];
    if (k === undefined) throw new Error('sin carrito');
    await e.api.llamar('guardarCarrito', { carritoId: k.carritoId, version: k.version, etiqueta: 'Mostrador' });
    await u.click(boton('Confirmar cobro'));
    expect(await screen.findByText(AVISO_CONFLICTO)).toBeTruthy();
    expect(await screen.findByRole('group', { name: 'Carrito' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Mostrador/ })).toBeTruthy();
    expect(await e.api.llamar('listarVentas', {})).toHaveLength(0);
  });

  it('si cancelar falla, lo pendiente se vuelve a guardar', async () => {
    const e = crearEntorno('caj');
    const u = userEvent.setup();
    await conTurno(e);
    const real = e.api.llamar.bind(e.api);
    let intentos = 0;
    vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, x: unknown) => {
      if (n !== 'cancelarCarrito') return real(n as never, x as never);
      intentos += 1;
      return Promise.reject(new ErrorApi('unavailable', 'Sin conexión'));
    }) as never);
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    await u.click(boton('Cancelar carrito Cliente 1'));
    await u.type(campo(/Motivo de la cancelación/), 'Prueba');
    await u.click(boton('Confirmar cancelación de Cliente 1'));
    await waitFor(() => expect(intentos).toBe(1));
    await waitFor(async () => expect((await e.api.llamar('misCarritos', {}))[0]?.contenido?.lineas).toHaveLength(1), { timeout: 4000 });
  });

  it('sin carritos y sin poder abrir uno, muestra el error con «Reintentar» y no queda cargando', async () => {
    const e = crearEntorno('caj');
    const u = userEvent.setup();
    await conTurno(e);
    const real = e.api.llamar.bind(e.api);
    const red = { falla: true };
    vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, x: unknown) => (n === 'crearCarrito' && red.falla ? Promise.reject(new ErrorApi('unavailable', 'Sin conexión')) : real(n as never, x as never))) as never);
    await u.click(boton('Cancelar carrito Cliente 1'));
    await u.type(campo(/Motivo de la cancelación/), 'Prueba');
    await u.click(boton('Confirmar cancelación de Cliente 1'));
    const reintentar = await screen.findByRole('button', { name: 'Reintentar' });
    red.falla = false;
    await u.click(reintentar);
    expect(await screen.findByRole('button', { name: /^Cliente \d/ })).toBeTruthy();
  });
});

describe('carritos: crédito y avisos al retomar', () => {
  it('la solicitud de crédito vive en el carrito: la aprobación sigue disponible tras «Volver» y «Cobrar»', async () => {
    const e = crearEntorno('caj');
    const u = userEvent.setup();
    await conTurno(e);
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    await u.type(campo(/Cliente \(opcional\)/), 'Ana Pérez');
    await u.click(boton('Cobrar'));
    await screen.findByRole('heading', { name: 'Cobro' });
    await u.selectOptions(within(screen.getByRole('group', { name: /Pago 1/ })).getByLabelText('Medio'), 'credito');
    await u.click(await screen.findByRole('button', { name: 'Solicitar aprobación del crédito' }));
    const [pendiente] = await e.api.llamar('listarAprobaciones', { estado: 'pendiente' });
    if (pendiente === undefined) throw new Error('sin solicitud');
    await waitFor(async () => expect((await e.api.llamar('misCarritos', {}))[0]?.contenido?.solicitudCreditoId).toBe(pendiente.aprobacionId));
    e.como('sup');
    await e.api.llamar('resolverAprobacion', { aprobacionId: pendiente.aprobacionId, decision: 'aprobar' });
    e.como('caj');
    await u.click(boton('Volver al carrito'));
    await u.click(boton('Cobrar'));
    await screen.findByRole('heading', { name: 'Cobro' });
    await u.selectOptions(within(screen.getByRole('group', { name: /Pago 1/ })).getByLabelText('Medio'), 'credito');
    expect(await screen.findByLabelText('Aprobación del crédito')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Solicitar aprobación del crédito' })).toBeNull();
  }, 20_000);

  it('tras recargar la página (se desmonta y se monta de nuevo) la solicitud de crédito sigue en el carrito', async () => {
    const e = crearEntorno('caj');
    const u = userEvent.setup();
    await conTurno(e);
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    await u.type(campo(/Cliente \(opcional\)/), 'Ana Pérez');
    await u.click(boton('Cobrar'));
    await screen.findByRole('heading', { name: 'Cobro' });
    await u.selectOptions(within(screen.getByRole('group', { name: /Pago 1/ })).getByLabelText('Medio'), 'credito');
    await u.click(await screen.findByRole('button', { name: 'Solicitar aprobación del crédito' }));
    const [pendiente] = await e.api.llamar('listarAprobaciones', { estado: 'pendiente' });
    if (pendiente === undefined) throw new Error('sin solicitud');
    await waitFor(async () => expect((await e.api.llamar('misCarritos', {}))[0]?.contenido?.solicitudCreditoId).toBe(pendiente.aprobacionId));
    cleanup();
    e.como('sup');
    await e.api.llamar('resolverAprobacion', { aprobacionId: pendiente.aprobacionId, decision: 'aprobar' });
    e.como('caj');
    render(pantalla(e, 'terminal'));
    await screen.findByRole('heading', { name: 'Productos' });
    await u.click(await screen.findByRole('button', { name: 'Cobrar' }));
    await screen.findByRole('heading', { name: 'Cobro' });
    await u.selectOptions(within(screen.getByRole('group', { name: /Pago 1/ })).getByLabelText('Medio'), 'credito');
    expect(await screen.findByLabelText('Aprobación del crédito')).toBeTruthy();
  }, 20_000);

  it('avisosAlRetomar: serie ya no disponible y precio cambiado en esta sesión', async () => {
    const e = crearEntorno('caj');
    const lista = await e.api.llamar('listarProductos', {});
    marcaDe(lista);
    const porId = new Map(lista.map((p) => [p.id, p]));
    const b = {
      mercadoId: 'BO', moneda: 'BOB', descTexto: '', descMotivo: '', aprobacionId: '', cliente: '', telefono: '', solicitadaId: null, creditoSolicitadoId: null,
      lineas: [
        { productoId: 'tv-55', almacenId: 'tienda' as const, cantidad: 2, series: ['TV55-001', 'SERIE-VENDIDA'] },
        { productoId: 'cable-hdmi', almacenId: 'tienda' as const, cantidad: 1, series: [] },
      ],
    };
    const precioDe = (p: { id: string }): number | null => (p.id === 'cable-hdmi' ? 900 : null);
    const avisos = await avisosAlRetomar(b, porId, [], e.api, { 'cable-hdmi': 800 }, precioDe);
    expect(avisos.some((a) => /La serie SERIE-VENDIDA de Televisor 55 pulgadas ya no está disponible/.test(a))).toBe(true);
    expect(avisos.some((a) => /TV55-001/.test(a))).toBe(false);
    const precio = avisos.find((a) => /El precio de Cable HDMI 2 m cambió/.test(a));
    expect(precio).toMatch(/en esta sesión/);
    expect(precio).toMatch(/se vuelve a validar al cobrar/);
    // Sin precio visto antes (otra sesión o recarga) no se avisa.
    expect((await avisosAlRetomar(b, porId, [], e.api, undefined, precioDe)).some((a) => /precio/.test(a))).toBe(false);
  });
});
