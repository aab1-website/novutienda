// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorApi } from '../../api/errores.js';
import type { VentaPos } from '../../api/tipos.js';
import { AHORA, crearEntorno, uuid, type Entorno } from '../../ayuda-pruebas.js';
import { ProveedorGuardia } from '../../ui/guardia.js';
import { conNombresDeFaltantes, VentaCobro } from './venta-cobro.js';
import { PantallaVenta } from './venta.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const campo = (re: RegExp): HTMLElement => screen.getByLabelText(re);
const boton = (nombre: string | RegExp): HTMLElement => screen.getByRole('button', { name: nombre });
const DIA = 86_400_000;

/** Pantalla de venta dentro de la guardia (que guarda los borradores entre pestañas), como en la aplicación. */
const pantalla = (e: Entorno, sub: string) => h(ProveedorGuardia, null, e.envolver(h(PantallaVenta, { sub })));

async function conTurno(e: Entorno): Promise<ReturnType<typeof render>> {
  await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 10000 } });
  const r = render(pantalla(e, 'terminal'));
  await screen.findByRole('heading', { name: 'Productos' });
  return r;
}

async function vender(e: Entorno, ahora: { valor: number }, cuando: number): Promise<void> {
  ahora.valor = cuando;
  await e.api.llamar('confirmarVenta', { requestId: uuid(), carrito: { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'cable-hdmi', cantidad: 1 }] }, pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 5568 }] });
}

describe('V-02 y V-01: el carrito se conserva y la barra lleva al carrito', () => {
  it('el carrito, el descuento y el cliente sobreviven a ir a Créditos y volver; «Nueva venta» los descarta', async () => {
    const e = crearEntorno('caj');
    const r = await conTurno(e);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    await u.type(campo(/Cliente \(opcional\)/), 'Ana Pérez');
    await u.type(campo(/Descuento \(monto\)/), '1');
    await u.type(campo(/Motivo del descuento/), 'Por la compra');
    r.rerender(pantalla(e, 'creditos'));
    await screen.findByRole('heading', { name: 'Cobro de créditos' });
    expect(screen.queryByRole('heading', { name: 'Carrito' })).toBeNull();
    r.rerender(pantalla(e, 'terminal'));
    await screen.findByRole('heading', { name: 'Carrito' });
    expect(within(screen.getByRole('group', { name: 'Carrito' })).getByText('Cable HDMI 2 m')).toBeTruthy();
    expect((campo(/Cliente \(opcional\)/) as HTMLInputElement).value).toBe('Ana Pérez');
    expect((campo(/Descuento \(monto\)/) as HTMLInputElement).value).toBe('1');
    expect((campo(/Motivo del descuento/) as HTMLInputElement).value).toBe('Por la compra');
    // Vender y pedir una venta nueva la deja vacía.
    await u.click(boton('Cobrar'));
    await screen.findByRole('heading', { name: 'Cobro' });
    await u.click(boton('Confirmar cobro'));
    await screen.findByRole('heading', { name: 'Venta registrada' });
    await u.click(boton('Nueva venta'));
    await screen.findByText('El carrito está vacío');
    expect((campo(/Cliente \(opcional\)/) as HTMLInputElement).value).toBe('');
  });

  it('una venta ya cobrada no reaparece en el carrito al volver a la pestaña', async () => {
    const e = crearEntorno('caj');
    const r = await conTurno(e);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    await u.click(boton('Cobrar'));
    await u.click(await screen.findByRole('button', { name: 'Confirmar cobro' }));
    await screen.findByRole('heading', { name: 'Venta registrada' });
    r.rerender(pantalla(e, 'creditos'));
    r.rerender(pantalla(e, 'terminal'));
    await screen.findByText('El carrito está vacío');
  });

  it('la barra fija resume los productos y el total, y «Ver carrito» lleva el foco al carrito', async () => {
    const e = crearEntorno('caj');
    await conTurno(e);
    expect(document.querySelector('.venta-barra')).toBeNull();
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    await waitFor(() => expect(document.querySelector('[data-prueba="barra-resumen"]')?.textContent).toBe('2 productos · Bs 111,36'));
    await u.click(within(screen.getByRole('region', { name: 'Resumen del carrito' })).getByRole('button', { name: 'Ver carrito' }));
    expect(document.activeElement).toBe(screen.getByRole('group', { name: 'Carrito' }));
  });

  it('en pantalla angosta, agregar deja un aviso; en ancha no', async () => {
    const e = crearEntorno('caj');
    await conTurno(e);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    expect(screen.queryByText('Se agregó Cable HDMI 2 m al carrito.')).toBeNull();
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('max-width'), media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
    await u.click(screen.getByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    expect(await screen.findByText('Se agregó Cable HDMI 2 m al carrito.')).toBeTruthy();
  });
});

describe('V-03: la aprobación llega sola', () => {
  it('mientras la solicitud está pendiente se consulta cada 4 s, sin botón «Actualizar aprobaciones»', async () => {
    // Solo los temporizadores de intervalo son falsos: las esperas y los reintentos de la prueba siguen siendo reales.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const e = crearEntorno('caj');
    await conTurno(e);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    await u.type(campo(/Descuento \(monto\)/), '10');
    await u.type(campo(/Motivo del descuento/), 'Cliente frecuente');
    await u.click(await screen.findByRole('button', { name: 'Solicitar aprobación' }));
    expect(await screen.findByText(/Esperando la aprobación/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Actualizar aprobaciones/ })).toBeNull();
    // El supervisor aprueba desde otra pantalla; el cajero no toca nada.
    e.como('sup');
    const pendiente = (await e.api.llamar('listarAprobaciones', { estado: 'pendiente' }))[0];
    await e.api.llamar('resolverAprobacion', { aprobacionId: pendiente?.aprobacionId ?? '', decision: 'aprobar' });
    e.como('caj');
    expect(screen.queryByLabelText('Aprobación a usar')).toBeNull();
    await vi.advanceTimersByTimeAsync(4000);
    expect(await screen.findByLabelText('Aprobación a usar')).toBeTruthy();
    // Resuelta la solicitud, ya no se consulta: ninguna llamada nueva en 20 s.
    await vi.advanceTimersByTimeAsync(5000);
    const antes = e.api.llamadas.filter((l) => l.nombre === 'listarAprobaciones').length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(e.api.llamadas.filter((l) => l.nombre === 'listarAprobaciones').length).toBe(antes);
  });
});

describe('la cajera ve el rechazo de su solicitud', () => {
  const rechazar = async (e: ReturnType<typeof crearEntorno>, motivo?: string): Promise<void> => {
    e.como('sup');
    const pendiente = (await e.api.llamar('listarAprobaciones', { estado: 'pendiente' }))[0];
    await e.api.llamar('resolverAprobacion', { aprobacionId: pendiente?.aprobacionId ?? '', decision: 'rechazar', ...(motivo !== undefined ? { motivo } : {}) });
    e.como('caj');
  };
  for (const [titulo, motivo] of [['con motivo', 'Supera el tope'], ['sin motivo', undefined]] as const) {
    it(`${titulo}: aviso claro y la consulta se detiene`, async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const e = crearEntorno('caj');
      await conTurno(e);
      const u = userEvent.setup();
      await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
      await u.type(campo(/Descuento \(monto\)/), '10');
      await u.type(campo(/Motivo del descuento/), 'Cliente frecuente');
      await u.click(await screen.findByRole('button', { name: 'Solicitar aprobación' }));
      expect(await screen.findByText(/Esperando la aprobación/)).toBeTruthy();
      await rechazar(e, motivo);
      await vi.advanceTimersByTimeAsync(4000);
      const aviso = await screen.findByText(/Su solicitud fue rechazada/);
      if (motivo === undefined) expect(aviso.textContent).not.toContain('Motivo:');
      else expect(aviso.textContent).toContain(`Motivo: ${motivo}`);
      expect(screen.queryByText(/Esperando la aprobación/)).toBeNull();
      await vi.advanceTimersByTimeAsync(5000);
      const antes = e.api.llamadas.filter((l) => l.nombre === 'listarAprobaciones').length;
      await vi.advanceTimersByTimeAsync(20_000);
      expect(e.api.llamadas.filter((l) => l.nombre === 'listarAprobaciones').length).toBe(antes);
    });
  }
});

describe('V-04 y G-06: monto prellenado y motivo de cada falta', () => {
  it('la primera fila de pago arranca con el total', async () => {
    const e = crearEntorno('caj');
    await conTurno(e);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    await u.click(boton('Cobrar'));
    await screen.findByRole('heading', { name: 'Cobro' });
    expect((campo(/Monto a aplicar/) as HTMLInputElement).value).toBe('55,68');
    expect(document.querySelector('[data-prueba="restante"]')?.textContent).toBe('Bs 0,00');
    expect(boton('Confirmar cobro').getAttribute('aria-disabled')).toBeNull();
  });

  it('«Cobrar» dice por qué no se puede, una falta por vez', async () => {
    const e = crearEntorno('caj');
    await conTurno(e);
    const u = userEvent.setup();
    expect(boton('Cobrar').getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Agregue al menos un producto al carrito.')).toBeTruthy();
    await u.click(await screen.findByRole('button', { name: 'Agregar Televisor 55 pulgadas' }));
    expect(await screen.findByText('Elija las series de Televisor 55 pulgadas.')).toBeTruthy();
    await u.click(await screen.findByRole('checkbox', { name: 'TV55-001' }));
    await waitFor(() => expect(boton('Cobrar').getAttribute('aria-disabled')).toBeNull());
    await u.type(campo(/Descuento \(monto\)/), '5000');
    expect(await screen.findByText('Corrija el descuento: debe ser menor al subtotal y llevar un motivo.')).toBeTruthy();
    await u.clear(campo(/Descuento \(monto\)/));
    await u.type(campo(/Descuento \(monto\)/), '200');
    await u.type(campo(/Motivo del descuento/), 'Cliente frecuente');
    expect(await screen.findByText('El descuento necesita la aprobación de un supervisor: solicítela abajo.')).toBeTruthy();
  });

  it('«Confirmar cobro» dice cuánto falta o que los pagos sobran', async () => {
    const e = crearEntorno('caj');
    await conTurno(e);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    await u.click(boton('Cobrar'));
    await screen.findByRole('heading', { name: 'Cobro' });
    await u.clear(campo(/Monto a aplicar/));
    await u.type(campo(/Monto a aplicar/), '20');
    expect(await screen.findByText('Falta cobrar Bs 35,68.')).toBeTruthy();
    expect(boton('Confirmar cobro').getAttribute('aria-disabled')).toBe('true');
    await u.clear(campo(/Monto a aplicar/));
    await u.type(campo(/Monto a aplicar/), '70');
    expect(await screen.findByText('Los pagos superan el total: ajuste los montos.')).toBeTruthy();
  });
});

describe('G-07: el faltante de stock lleva nombre', () => {
  const sinNombre = new ErrorApi('failed-precondition', 'x', { codigo: 'stock-insuficiente', faltantes: [{ productoId: 'parlante', almacenId: 'deposito-1', pedido: 2, disponible: 1 }] });

  it('completa producto y almacén desde lo ya cargado y respeta los que el servidor nombró', () => {
    const datos = { nombreProducto: (id: string) => (id === 'parlante' ? 'Parlante portátil' : undefined), nombreAlmacen: (id: string) => (id === 'deposito-1' ? 'Depósito 1' : undefined) };
    const r = conNombresDeFaltantes(sinNombre, datos) as ErrorApi;
    expect(r.detalle.faltantes?.[0]).toMatchObject({ productoNombre: 'Parlante portátil', almacenNombre: 'Depósito 1' });
    const con = new ErrorApi('failed-precondition', 'x', { codigo: 'stock-insuficiente', faltantes: [{ productoId: 'parlante', almacenId: 'tienda', pedido: 1, productoNombre: 'Del servidor', almacenNombre: 'Tienda' }] });
    expect((conNombresDeFaltantes(con, datos) as ErrorApi).detalle.faltantes?.[0]).toMatchObject({ productoNombre: 'Del servidor' });
    const otro = new Error('otro');
    expect(conNombresDeFaltantes(otro, datos)).toBe(otro);
  });

  it('al cobrar, el mensaje nombra el producto y el almacén, no sus códigos', async () => {
    const e = crearEntorno('caj');
    await conTurno(e);
    const original = e.api.llamar.bind(e.api);
    (e.api as { llamar: unknown }).llamar = async (n: string, entrada: unknown) => {
      if (n === 'confirmarVenta') throw new ErrorApi('failed-precondition', 'x', { codigo: 'stock-insuficiente', faltantes: [{ productoId: 'cable-hdmi', almacenId: 'tienda', pedido: 1, disponible: 0 }] });
      return original(n as never, entrada as never);
    };
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    await u.click(boton('Cobrar'));
    await u.click(await screen.findByRole('button', { name: 'Confirmar cobro' }));
    const textos = (await screen.findAllByText(/Cable HDMI 2 m en Tienda/)).map((x) => x.textContent ?? '');
    expect(textos.length).toBeGreaterThan(0);
    expect(textos.join(' ')).not.toContain('cable-hdmi');
  });
});

describe('V-06: el recibo se consulta cada 3 s y se puede reintentar', () => {
  it('si no llega en 30 s ofrece «Reintentar», que vuelve a consultar', async () => {
    const e = crearEntorno('caj');
    await conTurno(e);
    const original = e.api.llamar.bind(e.api);
    let bloqueado = true;
    let consultas = 0;
    (e.api as { llamar: unknown }).llamar = async (n: string, entrada: unknown) => {
      if (n === 'obtenerRecibo') {
        consultas += 1;
        if (bloqueado) return null;
      }
      return original(n as never, entrada as never);
    };
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    await u.click(boton('Cobrar'));
    await screen.findByRole('heading', { name: 'Cobro' });
    // Las esperas entre consultas son falsas desde aquí; el resto de la prueba sigue con eventos directos.
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    fireEvent.click(boton('Confirmar cobro'));
    await screen.findByText('Preparando el recibo…');
    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(3000);
    expect(await screen.findByText(/El recibo todavía no está listo/)).toBeTruthy();
    expect(consultas).toBe(11);
    bloqueado = false;
    fireEvent.click(boton('Reintentar'));
    expect(await screen.findByRole('article', { name: 'Recibo A-000001' })).toBeTruthy();
  });
});

describe('V-07 y V-08: historial con fechas, búsqueda, corte, recibo y anulación en diálogos', () => {
  const montar = async (): Promise<{ e: Entorno; ahora: { valor: number } }> => {
    const ahora = { valor: AHORA };
    const e = crearEntorno('caj', () => ahora.valor);
    await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 10000 } });
    await vender(e, ahora, AHORA - 5 * DIA);
    await vender(e, ahora, AHORA);
    render(pantalla(e, 'historial'));
    return { e, ahora };
  };

  it('filtra por fechas y por número de recibo', async () => {
    await montar();
    const u = userEvent.setup();
    await screen.findByText('A-000001');
    expect(screen.getByText('A-000002')).toBeTruthy();
    await u.type(campo(/Ventas desde/), '2026-11-02');
    await waitFor(() => expect(screen.queryByText('A-000001')).toBeNull());
    expect(screen.getByText('A-000002')).toBeTruthy();
    await u.clear(campo(/Ventas desde/));
    await u.type(campo(/Ventas hasta/), '2026-10-31');
    await waitFor(() => expect(screen.queryByText('A-000002')).toBeNull());
    expect(screen.getByText('A-000001')).toBeTruthy();
    await u.clear(campo(/Ventas hasta/));
    await screen.findByText('A-000002');
    await u.type(campo(/Buscar por número de recibo/), '000002');
    await waitFor(() => expect(screen.queryByText('A-000001')).toBeNull());
  });

  it('un rango invertido se avisa y no consulta', async () => {
    const { e } = await montar();
    const u = userEvent.setup();
    await screen.findByText('A-000001');
    await u.type(campo(/Ventas desde/), '2026-11-04');
    await u.type(campo(/Ventas hasta/), '2026-11-01');
    expect(await screen.findByText('La fecha Desde no puede ser posterior a Hasta.')).toBeTruthy();
    // Con el rango invertido nunca se consulta con las dos fechas.
    expect(e.api.llamadas.filter((l) => l.nombre === 'listarVentas').some((l) => (l.entrada as { desde?: string; hasta?: string }).desde !== undefined && (l.entrada as { hasta?: string }).hasta !== undefined)).toBe(false);
  });

  it('avisa que la lista está cortada al llegar al tope de 200', async () => {
    const { e } = await montar();
    cleanup();
    const base = (await e.api.llamar('listarVentas', {}))[0] as VentaPos;
    const muchas = Array.from({ length: 200 }, (_, i): VentaPos => ({ ...base, ventaId: `v-${i}`, receiptNo: i + 1 }));
    (e.api as { llamar: unknown }).llamar = async (n: string) => (n === 'listarVentas' ? muchas : []);
    render(pantalla(e, 'historial'));
    expect(await screen.findByText(/Se muestran las 200 ventas más recientes y puede haber más/)).toBeTruthy();
  });

  it('«Ver recibo» abre el comprobante en un diálogo', async () => {
    await montar();
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Ver recibo A-000001' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Recibo A-000001' });
    expect(await within(dialogo).findByRole('article', { name: 'Recibo A-000001' })).toBeTruthy();
    await u.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('la anulación se pide en un diálogo y deja un aviso', async () => {
    await montar();
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Solicitar anulación de A-000002' }));
    const dialogo = await screen.findByRole('dialog');
    expect(dialogo.querySelector('table')).toBeNull();
    expect(boton('Enviar solicitud').getAttribute('aria-disabled')).toBe('true');
    await u.type(within(dialogo).getByLabelText(/Motivo de la anulación/), 'Producto equivocado');
    await u.click(boton('Enviar solicitud'));
    expect(await screen.findByText('Anulación de A-000002 solicitada.')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Anulación solicitada')).toBeTruthy();
  });
});

describe('cobro sin duplicar y espera acotada de la aprobación', () => {
  it('si la venta se registró pero la respuesta no llegó, el reintento usa el mismo identificador y queda una sola venta', async () => {
    const e = crearEntorno('caj');
    await conTurno(e);
    const original = e.api.llamar.bind(e.api);
    let fallar = true;
    (e.api as { llamar: unknown }).llamar = async (n: string, entrada: unknown) => {
      const r = await original(n as never, entrada as never);
      if (n === 'confirmarVenta' && fallar) {
        fallar = false;
        throw new ErrorApi('unavailable', 'sin red');
      }
      return r;
    };
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    await u.click(boton('Cobrar'));
    await u.click(await screen.findByRole('button', { name: 'Confirmar cobro' }));
    await waitFor(() => expect(e.api.llamadas.filter((l) => l.nombre === 'confirmarVenta')).toHaveLength(1));
    // Se vuelve al carrito y se cobra de nuevo: el identificador sigue siendo el del borrador.
    await u.click(await screen.findByRole('button', { name: 'Volver al carrito' }));
    await u.click(boton('Cobrar'));
    await u.click(await screen.findByRole('button', { name: 'Confirmar cobro' }));
    await screen.findByRole('heading', { name: 'Venta registrada' });
    const ids = e.api.llamadas.filter((l) => l.nombre === 'confirmarVenta').map((l) => (l.entrada as { requestId: string }).requestId);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
    expect(await e.api.llamar('listarVentas', {})).toHaveLength(1);
    // La venta siguiente estrena identificador.
    await u.click(boton('Nueva venta'));
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    await u.click(boton('Cobrar'));
    await u.click(await screen.findByRole('button', { name: 'Confirmar cobro' }));
    await screen.findByRole('heading', { name: 'Venta registrada' });
    const todos = e.api.llamadas.filter((l) => l.nombre === 'confirmarVenta').map((l) => (l.entrada as { requestId: string }).requestId);
    expect(todos[2]).not.toBe(ids[0]);
  });

  const pedirDescuento = async (u: ReturnType<typeof userEvent.setup>): Promise<void> => {
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    await u.type(campo(/Descuento \(monto\)/), '10');
    await u.type(campo(/Motivo del descuento/), 'Cliente frecuente');
  };
  const consultas = (e: Entorno): number => e.api.llamadas.filter((l) => l.nombre === 'listarAprobaciones').length;

  it('una solicitud ajena o vieja no activa la consulta periódica y se ofrece «Volver a consultar»', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const e = crearEntorno('caj');
    await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 10000 } });
    await e.api.llamar('solicitarAprobacion', { aprobacionId: uuid(), solicitud: { tipo: 'descuento', moneda: 'BOB', monto: 1000, motivo: 'Vieja' } });
    render(pantalla(e, 'terminal'));
    await screen.findByRole('heading', { name: 'Productos' });
    await pedirDescuento(userEvent.setup());
    expect(await screen.findByText(/ya no se consulta sola/)).toBeTruthy();
    const antes = consultas(e);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(consultas(e)).toBe(antes);
    await userEvent.setup().click(boton('Volver a consultar'));
    await waitFor(() => expect(consultas(e)).toBe(antes + 1));
  });

  it('a los 10 minutos sin respuesta deja de consultar y ofrece «Volver a consultar», que reanuda', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const e = crearEntorno('caj');
    await conTurno(e);
    const u = userEvent.setup();
    await pedirDescuento(u);
    await u.click(await screen.findByRole('button', { name: 'Solicitar aprobación' }));
    expect(await screen.findByText(/Esperando la aprobación/)).toBeTruthy();
    await vi.advanceTimersByTimeAsync(600_000 + 4000);
    expect(await screen.findByText(/ya no se consulta sola/)).toBeTruthy();
    const antes = consultas(e);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(consultas(e)).toBe(antes);
    await u.click(boton('Volver a consultar'));
    expect(await screen.findByText(/Esperando la aprobación/)).toBeTruthy();
  });
});

describe('monto prellenado del cobro', () => {
  it('sigue al total mientras no se edite y respeta lo escrito', async () => {
    const e = crearEntorno('caj');
    const config = await e.api.llamar('leerConfigPos', {});
    const base = { mercado: 'BO', moneda: 'BOB', config, carrito: { mercado: 'BO', moneda: 'BOB', lineas: [], totalMostrado: 1000 }, aprobacionId: undefined, requestId: uuid() } as unknown as Parameters<typeof VentaCobro>[0]['datos'];
    const montar = (total: number) => e.envolver(h(VentaCobro, { datos: { ...base, total }, volver: () => undefined, alVender: () => undefined }));
    const r = render(montar(1000));
    expect((campo(/Monto a aplicar/) as HTMLInputElement).value).toBe('10,00');
    r.rerender(montar(2500));
    await waitFor(() => expect((campo(/Monto a aplicar/) as HTMLInputElement).value).toBe('25,00'));
    const u = userEvent.setup();
    await u.clear(campo(/Monto a aplicar/));
    await u.type(campo(/Monto a aplicar/), '7');
    r.rerender(montar(3000));
    expect((campo(/Monto a aplicar/) as HTMLInputElement).value).toBe('7');
  });
});

describe('revisión: venta repetida, sesión vencida y filas editadas', () => {
  it('una respuesta «repetida» se dice con claridad y muestra el recibo original', async () => {
    const e = crearEntorno('caj');
    await conTurno(e);
    const original = e.api.llamar.bind(e.api);
    (e.api as { llamar: unknown }).llamar = async (n: string, entrada: unknown) => {
      const r = await original(n as never, entrada as never);
      return n === 'confirmarVenta' ? { ...(r as object), repetida: true } : r;
    };
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    await u.click(boton('Cobrar'));
    await u.click(await screen.findByRole('button', { name: 'Confirmar cobro' }));
    expect(await screen.findByText(/Esta venta ya estaba registrada/)).toBeTruthy();
    expect(screen.queryByText('La venta se registró correctamente.')).toBeNull();
    expect(await screen.findByRole('article', { name: 'Recibo A-000001' })).toBeTruthy();
  });

  it('la espera de la aprobación no calla una sesión vencida: se detiene y avisa al panel', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const e = crearEntorno('caj');
    await conTurno(e);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Agregar Cable HDMI 2 m' }));
    await u.type(campo(/Descuento \(monto\)/), '10');
    await u.type(campo(/Motivo del descuento/), 'Cliente frecuente');
    await u.click(await screen.findByRole('button', { name: 'Solicitar aprobación' }));
    expect(await screen.findByText(/Esperando la aprobación/)).toBeTruthy();
    const original = e.api.llamar.bind(e.api);
    let sondeos = 0;
    (e.api as { llamar: unknown }).llamar = async (n: string, entrada: unknown) => {
      if (n === 'listarAprobaciones' && (entrada as { estado?: string }).estado === 'pendiente') {
        sondeos += 1;
        throw new ErrorApi('unauthenticated', 'La sesión no es válida');
      }
      return original(n as never, entrada as never);
    };
    e.renovacion.acepta = false;
    await vi.advanceTimersByTimeAsync(4000);
    await waitFor(() => expect(e.sesionesVencidas()).toBe(1));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sondeos).toBe(1);
  });

  it('el total no pisa una fila editada cuando se quita la primera', async () => {
    const e = crearEntorno('caj');
    const config = await e.api.llamar('leerConfigPos', {});
    const base = { mercado: 'BO', moneda: 'BOB', config, carrito: { mercado: 'BO', moneda: 'BOB', lineas: [], totalMostrado: 1000 }, aprobacionId: undefined, requestId: uuid() } as unknown as Parameters<typeof VentaCobro>[0]['datos'];
    const montar = (total: number) => e.envolver(h(VentaCobro, { datos: { ...base, total }, volver: () => undefined, alVender: () => undefined }));
    const r = render(montar(1000));
    const u = userEvent.setup();
    await u.click(screen.getByRole('button', { name: 'Agregar otro medio' }));
    const segundo = screen.getAllByRole('group', { name: /Pago/ })[1] as HTMLElement;
    await u.clear(within(segundo).getByLabelText(/Monto a aplicar/));
    await u.type(within(segundo).getByLabelText(/Monto a aplicar/), '3');
    await u.click(within(screen.getAllByRole('group', { name: /Pago/ })[0] as HTMLElement).getByRole('button', { name: 'Quitar este pago' }));
    r.rerender(montar(2500));
    await waitFor(() => expect(screen.getAllByRole('group', { name: /Pago/ })).toHaveLength(1));
    expect((campo(/Monto a aplicar/) as HTMLInputElement).value).toBe('3');
  });
});
