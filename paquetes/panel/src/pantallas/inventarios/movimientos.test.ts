// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, render, screen, waitFor, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorApi } from '../../api/errores.js';
import { crearEntorno, type Entorno } from '../../ayuda-pruebas.js';
import { ProveedorGuardia } from '../../ui/guardia.js';
import { PantallaInventario } from './inventario.js';
import { PantallaMermas } from './mermas.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type U = ReturnType<typeof userEvent.setup>;
const pantalla = (e: Entorno, sub: string): ReturnType<Entorno['envolver']> => e.envolver(h(ProveedorGuardia, null, h('a', { href: '#/otra' }, 'Ir a otra pantalla'), h(PantallaInventario, { sub })));
const ver = (e: Entorno, sub: string): ReturnType<typeof render> => render(pantalla(e, sub));
const producto = (): HTMLInputElement => screen.getByRole('combobox', { name: /^Producto/ }) as HTMLInputElement;
const elegir = async (u: U, texto: string, nombre: RegExp): Promise<void> => {
  await u.click(producto());
  await u.type(producto(), texto);
  await u.click(await screen.findByRole('option', { name: nombre }));
};
const llamadas = (e: Entorno, nombre: string): { entrada: Record<string, unknown> }[] => e.api.llamadas.filter((l) => l.nombre === nombre) as never;
/** Hace fallar la primera llamada a `nombre` y deja pasar las siguientes. */
const fallarUnaVez = (e: Entorno, nombre: string): unknown[] => {
  const ids: unknown[] = [];
  const original = e.api.llamar.bind(e.api);
  let falla = true;
  vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, en: { operacionId?: unknown }) => {
    if (n === nombre) ids.push(en.operacionId);
    if (n === nombre && falla) {
      falla = false;
      return Promise.reject(new ErrorApi('unavailable', 'sin red'));
    }
    return original(n as never, en as never);
  }) as never);
  return ids;
};

describe('ingreso', () => {
  it('el producto no tiene valor por omisión: registrar sin elegir marca el error y enfoca el selector, sin apagar el botón', async () => {
    const e = crearEntorno('adm');
    ver(e, 'ingreso');
    const u = userEvent.setup();
    await screen.findByRole('heading', { name: 'Ingreso de mercadería' });
    expect(producto().value).toBe('');
    const boton = screen.getByRole('button', { name: 'Registrar ingreso' }) as HTMLButtonElement;
    await u.click(boton);
    expect(boton.disabled).toBe(false);
    expect(await screen.findByText('Elija un producto de la lista.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(producto()));
    expect(screen.getByLabelText(/^Cantidad/).getAttribute('aria-invalid')).toBeNull();
    expect(llamadas(e, 'ingresar').length).toBe(0);
  });

  it('«1,5» marca el error junto a la cantidad, no apaga el botón', async () => {
    const e = crearEntorno('adm');
    ver(e, 'ingreso');
    const u = userEvent.setup();
    await screen.findByRole('heading', { name: 'Ingreso de mercadería' });
    await elegir(u, 'cable', /Cable HDMI/);
    await u.type(screen.getByLabelText(/^Cantidad/), '1,5');
    await u.click(screen.getByRole('button', { name: 'Registrar ingreso' }));
    expect(await screen.findByText(/Escriba un número entero, sin decimales/)).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/^Cantidad/)));
  });

  it('pide confirmar con un resumen; «Volver» no registra y «Sí, registrar» llama con un operacionId', async () => {
    const e = crearEntorno('adm');
    ver(e, 'ingreso');
    const u = userEvent.setup();
    await screen.findByRole('heading', { name: 'Ingreso de mercadería' });
    await elegir(u, 'cable', /Cable HDMI/);
    await u.type(screen.getByLabelText(/^Cantidad/), '4');
    await u.click(screen.getByRole('button', { name: 'Registrar ingreso' }));
    const d = await screen.findByRole('dialog', { name: '¿Registrar este ingreso?' });
    expect(d.closest('.dialogo-centro')).toBeTruthy();
    expect(within(d).getByText('Entra a Tienda:')).toBeTruthy();
    expect(within(d).getByText('4 × Cable HDMI 2 m')).toBeTruthy();
    await u.click(within(d).getByRole('button', { name: 'Volver' }));
    expect(llamadas(e, 'ingresar').length).toBe(0);
    await u.click(screen.getByRole('button', { name: 'Registrar ingreso' }));
    await u.click(within(await screen.findByRole('dialog', { name: '¿Registrar este ingreso?' })).getByRole('button', { name: 'Sí, registrar el ingreso' }));
    expect(await screen.findByText('Ingreso registrado.')).toBeTruthy();
    expect(typeof llamadas(e, 'ingresar')[0]?.entrada['operacionId']).toBe('string');
    expect((await e.api.llamar('listarProductos', {})).find((p) => p.id === 'cable-hdmi')?.stockTotal).toBe(39);
    // El formulario queda limpio: sin producto elegido.
    await waitFor(() => expect(producto().value).toBe(''));
  });

  it('si el envío falla, el error se ve dentro de la confirmación y el reintento usa el MISMO operacionId', async () => {
    const e = crearEntorno('adm');
    const ids = fallarUnaVez(e, 'ingresar');
    ver(e, 'ingreso');
    const u = userEvent.setup();
    await screen.findByRole('heading', { name: 'Ingreso de mercadería' });
    await elegir(u, 'cable', /Cable HDMI/);
    await u.type(screen.getByLabelText(/^Cantidad/), '2');
    await u.click(screen.getByRole('button', { name: 'Registrar ingreso' }));
    let d = await screen.findByRole('dialog', { name: '¿Registrar este ingreso?' });
    await u.click(within(d).getByRole('button', { name: 'Sí, registrar el ingreso' }));
    expect(await within(d).findByText(/No hay conexión/)).toBeTruthy();
    // Volver y abrir de nuevo (mismos datos) y reintentar.
    await u.click(within(d).getByRole('button', { name: 'Volver' }));
    await u.click(screen.getByRole('button', { name: 'Registrar ingreso' }));
    d = await screen.findByRole('dialog', { name: '¿Registrar este ingreso?' });
    await u.click(within(d).getByRole('button', { name: 'Sí, registrar el ingreso' }));
    expect(await screen.findByText('Ingreso registrado.')).toBeTruthy();
    expect(ids.length).toBe(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it('un producto con serie pide una serie por unidad y el resumen las nombra', async () => {
    const e = crearEntorno('adm');
    ver(e, 'ingreso');
    const u = userEvent.setup();
    await screen.findByRole('heading', { name: 'Ingreso de mercadería' });
    await elegir(u, 'celular', /Celular A1/);
    await u.type(screen.getByLabelText(/^Series/), 'N-100, N-101');
    await u.click(screen.getByRole('button', { name: 'Registrar ingreso' }));
    const d = await screen.findByRole('dialog', { name: '¿Registrar este ingreso?' });
    expect(within(d).getByText('2 series de Celular A1 128 GB (N-100, N-101)')).toBeTruthy();
    await u.click(within(d).getByRole('button', { name: 'Sí, registrar el ingreso' }));
    await screen.findByText('Ingreso registrado.');
    expect((await e.api.llamar('buscarSerie', { serie: 'N-10' })).length).toBe(2);
  });

  it('guardia y borrador: con líneas sin guardar, un enlace interno pregunta; el borrador sobrevive al cambio de pestaña', async () => {
    const e = crearEntorno('adm');
    const { rerender } = ver(e, 'ingreso');
    const u = userEvent.setup();
    await screen.findByRole('heading', { name: 'Ingreso de mercadería' });
    await elegir(u, 'cable', /Cable HDMI/);
    await u.type(screen.getByLabelText(/^Cantidad/), '7');
    await u.click(screen.getByRole('link', { name: 'Ir a otra pantalla' }));
    const pregunta = await screen.findByRole('dialog', { name: '¿Salir sin guardar?' });
    await u.click(within(pregunta).getByRole('button', { name: 'Seguir editando' }));
    rerender(pantalla(e, 'traspasos'));
    await screen.findByRole('heading', { name: 'Traspaso entre almacenes' });
    rerender(pantalla(e, 'ingreso'));
    await screen.findByRole('heading', { name: 'Ingreso de mercadería' });
    expect(producto().value).toBe('Cable HDMI 2 m');
    expect((screen.getByLabelText(/^Cantidad/) as HTMLInputElement).value).toBe('7');
  });
});

describe('traspaso', () => {
  it('avisa junto a la cantidad si pide más de lo que hay en el origen y dice cuánto hay', async () => {
    const e = crearEntorno('sup');
    ver(e, 'traspasos');
    const u = userEvent.setup();
    await screen.findByRole('heading', { name: 'Traspaso entre almacenes' });
    await elegir(u, 'cable', /Cable HDMI/);
    expect(screen.getByText('En Depósito 1 hay 10.')).toBeTruthy();
    await u.type(screen.getByLabelText(/^Cantidad/), '11');
    await u.click(screen.getByRole('button', { name: 'Traspasar' }));
    expect(await screen.findByText(/En Depósito 1 hay 10 de «Cable HDMI 2 m»; no se pueden pasar 11/)).toBeTruthy();
    expect(llamadas(e, 'traspasar').length).toBe(0);
  });

  it('origen y destino iguales se marcan en el destino', async () => {
    const e = crearEntorno('sup');
    ver(e, 'traspasos');
    const u = userEvent.setup();
    await screen.findByRole('heading', { name: 'Traspaso entre almacenes' });
    await u.selectOptions(screen.getByLabelText('Destino'), 'deposito-1');
    await elegir(u, 'cable', /Cable HDMI/);
    await u.type(screen.getByLabelText(/^Cantidad/), '1');
    await u.click(screen.getByRole('button', { name: 'Traspasar' }));
    expect(await screen.findByText(/Error: El origen y el destino deben ser distintos/)).toBeTruthy();
  });

  it('con conteo abierto en el origen o el destino, sup ve el motivo junto al almacén, «Traspasar» queda desactivado y no llama; adm traspasa', async () => {
    const motivo = (n: string): string => `No se puede traspasar desde ni hacia ${n} mientras tiene un conteo abierto. Puede hacerlo un administrador o esperar al cierre.`;
    const e = crearEntorno('sup');
    await e.api.llamar('abrirConteo', { operacionId: 'a1', conteoId: 'c-dep1', ubicacionId: 'deposito-1' });
    ver(e, 'traspasos');
    const u = userEvent.setup();
    await screen.findByRole('heading', { name: 'Traspaso entre almacenes' });
    // Origen por omisión: Depósito 1, en conteo.
    expect((await screen.findAllByText(motivo('Depósito 1'))).length).toBeGreaterThan(0);
    const boton = screen.getByRole('button', { name: 'Traspasar' });
    expect(boton.getAttribute('aria-disabled')).toBe('true');
    await u.click(boton);
    expect(llamadas(e, 'traspasar').length).toBe(0);
    // Destino en conteo.
    await u.selectOptions(screen.getByLabelText('Origen'), 'deposito-2');
    await u.selectOptions(screen.getByLabelText('Destino'), 'deposito-1');
    expect((await screen.findAllByText(motivo('Depósito 1'))).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Traspasar' }).getAttribute('aria-disabled')).toBe('true');
    // Sin el almacén en conteo, se puede.
    await u.selectOptions(screen.getByLabelText('Destino'), 'tienda');
    await waitFor(() => expect(screen.queryByText(motivo('Depósito 1'))).toBeNull());
    expect(screen.getByRole('button', { name: 'Traspasar' }).getAttribute('aria-disabled')).not.toBe('true');
  });

  it('adm no ve el motivo ni se le desactiva «Traspasar» con un conteo abierto', async () => {
    const e = crearEntorno('sup');
    await e.api.llamar('abrirConteo', { operacionId: 'a1', conteoId: 'c-dep1', ubicacionId: 'deposito-1' });
    e.como('adm');
    ver(e, 'traspasos');
    await screen.findByRole('heading', { name: 'Traspaso entre almacenes' });
    expect(screen.queryByText(/No se puede traspasar desde ni hacia/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Traspasar' }).getAttribute('aria-disabled')).not.toBe('true');
  });

  it('el resumen nombra origen y destino; confirma y la tabla usa nombres legibles', async () => {
    const e = crearEntorno('sup');
    ver(e, 'traspasos');
    const u = userEvent.setup();
    await screen.findByRole('heading', { name: 'Traspaso entre almacenes' });
    await elegir(u, 'cable', /Cable HDMI/);
    await u.type(screen.getByLabelText(/^Cantidad/), '4');
    await u.click(screen.getByRole('button', { name: 'Traspasar' }));
    const d = await screen.findByRole('dialog', { name: '¿Registrar este traspaso?' });
    expect(within(d).getByText('De Depósito 1 a Tienda:')).toBeTruthy();
    await u.click(within(d).getByRole('button', { name: 'Sí, traspasar' }));
    expect(await screen.findByText(/Traspaso registrado/)).toBeTruthy();
    const tabla = await screen.findByRole('table', { name: 'Movimientos de inventario' });
    await waitFor(() => expect(tabla.textContent).toMatch(/Traspaso/));
    expect(tabla.textContent).not.toMatch(/deposito-1/);
    expect(llamadas(e, 'traspasar')[0]?.entrada).toMatchObject({ origenId: 'deposito-1', destinoId: 'tienda' });
  });
});

describe('ajuste', () => {
  it('muestra «Hay 25, quedarán 23», lo repite en la confirmación y aplica con un operacionId', async () => {
    const e = crearEntorno('adm');
    ver(e, 'ajuste');
    const u = userEvent.setup();
    await screen.findByRole('heading', { name: /Ajuste de existencias/ });
    await elegir(u, 'cable', /Cable HDMI/);
    await u.type(screen.getByLabelText(/^Diferencia/), '-2');
    expect(screen.getByText('Hay 25, quedarán 23.')).toBeTruthy();
    await u.type(screen.getByLabelText(/^Motivo/), 'Rotura en depósito');
    await u.click(screen.getByRole('button', { name: 'Aplicar ajuste' }));
    const d = await screen.findByRole('dialog', { name: '¿Aplicar este ajuste?' });
    expect(within(d).getByText('Cable HDMI 2 m en Tienda: Hay 25, quedarán 23.')).toBeTruthy();
    await u.click(within(d).getByRole('button', { name: 'Sí, aplicar el ajuste' }));
    expect(await screen.findByText('Ajuste registrado.')).toBeTruthy();
    expect(typeof llamadas(e, 'ajustar')[0]?.entrada['operacionId']).toBe('string');
    expect((await e.api.llamar('listarProductos', {})).find((p) => p.id === 'cable-hdmi')?.stockTotal).toBe(33);
  });

  it('«1,5» y un ajuste que dejaría negativo se marcan junto al campo; el botón sigue activo', async () => {
    const e = crearEntorno('adm');
    ver(e, 'ajuste');
    const u = userEvent.setup();
    await screen.findByRole('heading', { name: /Ajuste de existencias/ });
    await elegir(u, 'cable', /Cable HDMI/);
    await u.type(screen.getByLabelText(/^Diferencia/), '1,5');
    await u.type(screen.getByLabelText(/^Motivo/), 'x');
    const boton = screen.getByRole('button', { name: 'Aplicar ajuste' }) as HTMLButtonElement;
    await u.click(boton);
    expect(boton.disabled).toBe(false);
    expect(await screen.findByText(/Escriba un número entero distinto de 0/)).toBeTruthy();
    await u.clear(screen.getByLabelText(/^Diferencia/));
    await u.type(screen.getByLabelText(/^Diferencia/), '-30');
    expect(await screen.findByText(/Hay 25, quedarán -5: no puede quedar en negativo/)).toBeTruthy();
    expect(llamadas(e, 'ajustar').length).toBe(0);
  });

  const prepararAjuste = async (e: Entorno, u: U): Promise<void> => {
    ver(e, 'ajuste');
    await screen.findByRole('heading', { name: /Ajuste de existencias/ });
    await elegir(u, 'cable', /Cable HDMI/);
    await u.type(screen.getByLabelText(/^Diferencia/), '-2');
    await u.type(screen.getByLabelText(/^Motivo/), 'Rotura en depósito');
  };

  it('al abrir la confirmación relee las existencias: si cambiaron mientras tanto, la cifra es la fresca y el operacionId es el mismo', async () => {
    const e = crearEntorno('adm');
    const u = userEvent.setup();
    await prepararAjuste(e, u);
    expect(screen.getByText('Hay 25, quedarán 23.')).toBeTruthy();
    // Otra persona ingresa 5 unidades después de montar la pantalla.
    await e.api.llamar('ingresar', { operacionId: 'otro-ingreso', ubicacionId: 'tienda', lineas: [{ productoId: 'cable-hdmi', cantidad: 5 }] });
    const lecturas = llamadas(e, 'listarProductos').length;
    await u.click(screen.getByRole('button', { name: 'Aplicar ajuste' }));
    const d = await screen.findByRole('dialog', { name: '¿Aplicar este ajuste?' });
    expect(await within(d).findByText('Cable HDMI 2 m en Tienda: Hay 30, quedarán 28.')).toBeTruthy();
    expect(llamadas(e, 'listarProductos').length).toBeGreaterThan(lecturas);
    await u.click(within(d).getByRole('button', { name: 'Sí, aplicar el ajuste' }));
    expect(await screen.findByText('Ajuste registrado.')).toBeTruthy();
    expect(llamadas(e, 'ajustar').length).toBe(1);
  });

  it('mientras relee muestra el estado de carga dentro del diálogo y no deja confirmar', async () => {
    const e = crearEntorno('adm');
    const u = userEvent.setup();
    await prepararAjuste(e, u);
    const original = e.api.llamar.bind(e.api);
    let soltar: () => void = () => undefined;
    vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, en: unknown) => (n === 'listarProductos' ? new Promise((r) => { soltar = () => r(original(n as never, en as never)); }) : original(n as never, en as never))) as never);
    await u.click(screen.getByRole('button', { name: 'Aplicar ajuste' }));
    const d = await screen.findByRole('dialog', { name: '¿Aplicar este ajuste?' });
    expect(within(d).getByText(/leyendo las existencias actuales/)).toBeTruthy();
    expect(within(d).getByRole('button', { name: 'Procesando…' }).hasAttribute('disabled')).toBe(true);
    soltar();
    expect(await within(d).findByText('Cable HDMI 2 m en Tienda: Hay 25, quedarán 23.')).toBeTruthy();
  });

  it('si la relectura falla, el resumen no lleva cifra, dice que el servidor valida y se puede confirmar', async () => {
    const e = crearEntorno('adm');
    const u = userEvent.setup();
    await prepararAjuste(e, u);
    const original = e.api.llamar.bind(e.api);
    vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, en: unknown) => (n === 'listarProductos' ? Promise.reject(new ErrorApi('unavailable', 'sin red')) : original(n as never, en as never))) as never);
    await u.click(screen.getByRole('button', { name: 'Aplicar ajuste' }));
    const d = await screen.findByRole('dialog', { name: '¿Aplicar este ajuste?' });
    const linea = await within(d).findByText(/no se pudieron leer las existencias actuales; el servidor valida al registrar/);
    expect(linea.textContent).not.toMatch(/quedarán/);
    await u.click(within(d).getByRole('button', { name: 'Sí, aplicar el ajuste' }));
    expect(await screen.findByText('Ajuste registrado.')).toBeTruthy();
  });

  it('no ofrece productos con serie', async () => {
    const e = crearEntorno('adm');
    ver(e, 'ajuste');
    const u = userEvent.setup();
    await screen.findByRole('heading', { name: /Ajuste de existencias/ });
    await u.click(producto());
    await u.type(producto(), 'televisor');
    expect(screen.queryByRole('option', { name: /Televisor/ })).toBeNull();
  });
});

describe('merma: el mismo selector, sin valor por omisión', () => {
  it('el producto arranca sin elegir y «Solicitar merma» espera a que se elija', async () => {
    const e = crearEntorno('sup');
    render(e.envolver(h(PantallaMermas, {})));
    await screen.findByRole('heading', { name: 'Mermas' });
    await waitFor(() => expect(screen.getByRole('combobox', { name: /^Producto/ })).toBeTruthy());
    expect((screen.getByRole('combobox', { name: /^Producto/ }) as HTMLInputElement).value).toBe('');
  });
});
