// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, render, screen, waitFor, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorApi } from '../../api/errores.js';
import { crearEntorno, type Entorno } from '../../ayuda-pruebas.js';
import { ProveedorGuardia } from '../../ui/guardia.js';
import { Conteo } from './conteo.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ver = (e: Entorno): void => void render(e.envolver(h(ProveedorGuardia, null, h(Conteo, {}))));
const abrir = async (e: Entorno): Promise<ReturnType<typeof userEvent.setup>> => {
  ver(e);
  const u = userEvent.setup();
  await u.click(await screen.findByRole('button', { name: 'Abrir conteo' }));
  await screen.findByText(/Escriba lo que cuenta de cada producto/);
  return u;
};
const llamadas = (e: Entorno, nombre: string): { entrada: Record<string, unknown> }[] => e.api.llamadas.filter((l) => l.nombre === nombre) as never;

describe('conteo ciego', () => {
  it('no muestra existencias del sistema mientras se cuenta y muestra el avance', async () => {
    const e = crearEntorno('sup');
    await abrir(e);
    expect(screen.queryByRole('columnheader', { name: /Sistema|Existencia|Total/ })).toBeNull();
    const tabla = screen.getByRole('table', { name: 'Productos a contar' });
    // Las existencias demo (25 de cable, 5 del televisor) no aparecen en ninguna celda.
    expect(within(tabla).queryByText('25')).toBeNull();
    expect(screen.getByText(/Avance: 0 de \d+/)).toBeTruthy();
  });

  it('arma la lista con la del conteo: no llama a listarProductos y ningún dato recibido ni el DOM traen existencias', async () => {
    const e = crearEntorno('sup');
    const recibido: string[] = [];
    const original = e.api.llamar.bind(e.api);
    vi.spyOn(e.api, 'llamar').mockImplementation((async (n: string, en: never) => {
      const r = await original(n as never, en);
      recibido.push(JSON.stringify(r));
      return r;
    }) as never);
    await abrir(e);
    expect(llamadas(e, 'listarProductos')).toHaveLength(0);
    expect(recibido.join('')).not.toMatch(/existencias|stockTotal|bajoMinimo|faltan|teorico/);
    expect(screen.queryByRole('columnheader', { name: /Sistema|Existencia|Stock/i })).toBeNull();
    expect(document.body.textContent).not.toMatch(/Sistema:|Stock|Disponible/);
  });

  it('guarda al salir del campo si cambió, marca «Guardado» y sube el avance', async () => {
    const e = crearEntorno('sup');
    const u = await abrir(e);
    const campo = screen.getByLabelText('Cantidad de Cable HDMI 2 m');
    await u.type(campo, '20');
    expect(llamadas(e, 'registrarLineaConteo')).toHaveLength(0);
    await u.tab();
    await waitFor(() => expect(llamadas(e, 'registrarLineaConteo')).toHaveLength(1));
    expect(llamadas(e, 'registrarLineaConteo')[0]?.entrada).toMatchObject({ productoId: 'cable-hdmi', contado: 20 });
    await waitFor(() => expect(screen.getByText(/Avance: 1 de \d+/)).toBeTruthy());
    // Salir otra vez sin cambiar no vuelve a guardar.
    await u.click(campo);
    await u.tab();
    expect(llamadas(e, 'registrarLineaConteo')).toHaveLength(1);
    expect(within(campo.closest('td') as HTMLElement).getByText('Guardado')).toBeTruthy();
  });

  it('un valor inválido marca el error junto al campo y no llama al servidor', async () => {
    const e = crearEntorno('sup');
    const u = await abrir(e);
    await u.type(screen.getByLabelText('Cantidad de Cable HDMI 2 m'), '2,5');
    await u.tab();
    expect(await screen.findByText(/Escriba un número entero de 0 o más/)).toBeTruthy();
    expect(llamadas(e, 'registrarLineaConteo')).toHaveLength(0);
  });

  it('si el guardado falla dice qué producto y reintenta con el mismo identificador', async () => {
    const e = crearEntorno('sup');
    const u = await abrir(e);
    const original = e.api.llamar.bind(e.api);
    const ids: unknown[] = [];
    let falla = true;
    vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, en: { operacionId?: unknown }) => {
      if (n === 'registrarLineaConteo') {
        ids.push(en.operacionId);
        if (falla) {
          falla = false;
          return Promise.reject(new ErrorApi('unavailable', 'sin red'));
        }
      }
      return original(n as never, en as never);
    }) as never);
    await u.type(screen.getByLabelText('Cantidad de Cable HDMI 2 m'), '20');
    await u.tab();
    expect((await screen.findByText(/No se pudo guardar Cable HDMI 2 m/))).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Reintentar guardar Cable HDMI 2 m' }));
    await waitFor(() => expect(ids).toHaveLength(2));
    expect(ids[1]).toBe(ids[0]);
    await waitFor(() => expect(screen.getByText(/Avance: 1 de/)).toBeTruthy());
  });

  it('busca un producto entre los que hay que contar', async () => {
    const e = crearEntorno('sup');
    const u = await abrir(e);
    await u.type(screen.getByLabelText('Buscar producto a contar'), 'televisor');
    expect(screen.queryByLabelText('Cantidad de Cable HDMI 2 m')).toBeNull();
    expect(screen.getByLabelText(/Series de Televisor 55 pulgadas/)).toBeTruthy();
  });

  it('no deja cerrar con cantidades sin guardar y dice cuántas', async () => {
    const e = crearEntorno('sup');
    const u = await abrir(e);
    await u.type(screen.getByLabelText('Cantidad de Cable HDMI 2 m'), '20');
    expect(screen.getByText(/Hay 1 cantidad sin guardar/)).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Cerrar y firmar el conteo' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('al cerrar confirma con «Faltan N productos por contar» calculado en el panel y firma', async () => {
    const e = crearEntorno('sup');
    const u = await abrir(e);
    await u.type(screen.getByLabelText('Cantidad de Cable HDMI 2 m'), '20');
    await u.tab();
    await waitFor(() => expect(screen.getByText(/Avance: 1 de/)).toBeTruthy());
    await u.click(screen.getByRole('button', { name: 'Cerrar y firmar el conteo' }));
    const d = await screen.findByRole('dialog', { name: '¿Cerrar y firmar el conteo?' });
    expect(d.textContent).toMatch(/Faltan \d+ productos por contar\.\s*Esos productos quedan como están en el sistema\./);
    expect(d.textContent).toContain('Contó 1 de');
    expect((within(d).getByRole('radio', { name: 'Dejarlos como están' }) as HTMLInputElement).checked).toBe(true);
    await u.click(within(d).getByRole('button', { name: 'Sí, cerrar y firmar' }));
    expect(await screen.findByText(/Conteo cerrado y firmado/)).toBeTruthy();
    const tabla = await screen.findByRole('table', { name: 'Resultado del conteo' });
    expect(tabla.textContent).toContain('-5');
  });

  const escribir = async (u: ReturnType<typeof userEvent.setup>, valor: string): Promise<void> => {
    const campo = screen.getByLabelText('Cantidad de Cable HDMI 2 m');
    await u.click(campo);
    await u.clear(campo);
    await u.type(campo, valor);
    await u.tab();
  };
  const contadoEnServidor = (e: Entorno): number | undefined => [...e.api.estado.conteos.values()][0]?.lineas.find((l) => l.productoId === 'cable-hdmi')?.contado;

  it('escribir 5, luego 6 y otra vez 5 deja 5 en el servidor: cada guardado bueno descarta su identificador', async () => {
    const e = crearEntorno('sup');
    const u = await abrir(e);
    await escribir(u, '5');
    await waitFor(() => expect(contadoEnServidor(e)).toBe(5));
    await escribir(u, '6');
    await waitFor(() => expect(contadoEnServidor(e)).toBe(6));
    await escribir(u, '5');
    await waitFor(() => expect(contadoEnServidor(e)).toBe(5));
    const ids = llamadas(e, 'registrarLineaConteo').map((l) => l.entrada['operacionId']);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    const campo = screen.getByLabelText('Cantidad de Cable HDMI 2 m');
    await waitFor(() => expect(within(campo.closest('td') as HTMLElement).getByText('Guardado')).toBeTruthy());
  });

  it('dos cambios rápidos del mismo campo se envían en orden y queda el último', async () => {
    const e = crearEntorno('sup');
    const u = await abrir(e);
    const original = e.api.llamar.bind(e.api);
    const orden: string[] = [];
    let soltar: () => void = () => undefined;
    const puerta = new Promise<void>((r) => { soltar = r; });
    let primera = true;
    vi.spyOn(e.api, 'llamar').mockImplementation((async (n: string, en: { contado?: number }) => {
      if (n === 'registrarLineaConteo') {
        orden.push(`inicio-${String(en.contado)}`);
        if (primera) {
          primera = false;
          await puerta;
        }
        const r = await original(n as never, en as never);
        orden.push(`fin-${String(en.contado)}`);
        return r;
      }
      return original(n as never, en as never);
    }) as never);
    await escribir(u, '5');
    await escribir(u, '6');
    expect(orden).toEqual(['inicio-5']);
    soltar();
    await waitFor(() => expect(contadoEnServidor(e)).toBe(6));
    await waitFor(() => expect(orden).toEqual(['inicio-5', 'fin-5', 'inicio-6', 'fin-6']));
  });

  it('con un guardado fallido no deja cerrar y avisa; el reintento reusa el identificador y luego sí se cierra', async () => {
    const e = crearEntorno('sup');
    const u = await abrir(e);
    const original = e.api.llamar.bind(e.api);
    const ids: unknown[] = [];
    let falla = true;
    vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, en: { operacionId?: unknown }) => {
      if (n === 'registrarLineaConteo') {
        ids.push(en.operacionId);
        if (falla) {
          falla = false;
          return Promise.reject(new ErrorApi('unavailable', 'sin red'));
        }
      }
      return original(n as never, en as never);
    }) as never);
    await escribir(u, '5');
    expect(await screen.findByText(/No se pudo guardar Cable HDMI 2 m/)).toBeTruthy();
    expect(screen.getByText(/Hay 1 cantidad sin guardar/)).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Cerrar y firmar el conteo' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await u.click(screen.getByRole('button', { name: 'Reintentar guardar Cable HDMI 2 m' }));
    await waitFor(() => expect(contadoEnServidor(e)).toBe(5));
    expect(ids[1]).toBe(ids[0]);
    await waitFor(() => expect(screen.queryByText(/Hay 1 cantidad sin guardar/)).toBeNull());
    await u.click(screen.getByRole('button', { name: 'Cerrar y firmar el conteo' }));
    expect(await screen.findByRole('dialog', { name: '¿Cerrar y firmar el conteo?' })).toBeTruthy();
  });

  const abrirCierre = async (u: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> => {
    await u.click(screen.getByRole('button', { name: 'Cerrar y firmar el conteo' }));
    return screen.findByRole('dialog', { name: '¿Cerrar y firmar el conteo?' });
  };

  it('«Tomarlos como 0» envía sinContar «cero» y genera la merma; por defecto envía «igual»', async () => {
    const e = crearEntorno('sup');
    const u = await abrir(e);
    await escribir(u, '20');
    await waitFor(() => expect(screen.getByText(/Avance: 1 de/)).toBeTruthy());
    const d = await abrirCierre(u);
    await u.click(within(d).getByRole('radio', { name: 'Tomarlos como 0 (generan merma)' }));
    expect(d.textContent).toContain('se tomarán como 0 y generarán mermas');
    await u.click(within(d).getByRole('button', { name: 'Sí, cerrar y firmar' }));
    await screen.findByText(/Conteo cerrado y firmado/);
    expect(llamadas(e, 'cerrarConteo')[0]?.entrada).toMatchObject({ sinContar: 'cero' });
    expect(e.api.estado.mermas.length).toBeGreaterThan(0);
  });

  it('con «como están» no se crean mermas y se envía «igual»', async () => {
    const e = crearEntorno('sup');
    const u = await abrir(e);
    await escribir(u, '20');
    await waitFor(() => expect(screen.getByText(/Avance: 1 de/)).toBeTruthy());
    const d = await abrirCierre(u);
    await u.click(within(d).getByRole('button', { name: 'Sí, cerrar y firmar' }));
    await screen.findByText(/Conteo cerrado y firmado/);
    expect(llamadas(e, 'cerrarConteo')[0]?.entrada).toMatchObject({ sinContar: 'igual' });
    expect(e.api.estado.mermas.every((m) => m.productoId === 'cable-hdmi')).toBe(true);
  });

  it('con nada contado y «como están» no deja cerrar y lo dice; con «0» sí', async () => {
    const e = crearEntorno('sup');
    const u = await abrir(e);
    const d = await abrirCierre(u);
    expect(d.textContent).toContain('No hay productos contados: no hay nada que cerrar.');
    expect((within(d).getByRole('button', { name: 'Sí, cerrar y firmar' }) as HTMLButtonElement).getAttribute('aria-disabled') === 'true' || (within(d).getByRole('button', { name: 'Sí, cerrar y firmar' }) as HTMLButtonElement).disabled).toBe(true);
    await u.click(within(d).getByRole('radio', { name: 'Tomarlos como 0 (generan merma)' }));
    expect(d.textContent).not.toContain('No hay productos contados');
  });

  it('«Cancelar conteo» solo lo ve el administrador', async () => {
    const e = crearEntorno('sup');
    await abrir(e);
    expect(screen.queryByRole('button', { name: 'Cancelar conteo' })).toBeNull();
  });

  it('el administrador cancela con motivo obligatorio y el historial lo muestra como «Cancelado»', async () => {
    const e = crearEntorno('adm');
    const u = await abrir(e);
    await u.click(screen.getByRole('button', { name: 'Cancelar conteo' }));
    const d = await screen.findByRole('dialog', { name: '¿Cancelar el conteo?' });
    await u.click(within(d).getByRole('button', { name: 'Sí, cancelar conteo' }));
    expect(await within(d).findByText(/Escriba el motivo de la cancelación/)).toBeTruthy();
    expect(llamadas(e, 'cancelarConteo')).toHaveLength(0);
    await u.type(within(d).getByLabelText(/Motivo de la cancelación/), 'Se abrió en el almacén equivocado');
    await u.click(within(d).getByRole('button', { name: 'Sí, cancelar conteo' }));
    expect(await screen.findByText(/Conteo cancelado/)).toBeTruthy();
    expect(llamadas(e, 'cancelarConteo')[0]?.entrada).toMatchObject({ motivo: 'Se abrió en el almacén equivocado' });
    const h = await screen.findByText('Cancelado');
    expect(h.closest('p')?.textContent).toContain('Se abrió en el almacén equivocado');
    expect(h.closest('p')?.textContent).not.toContain('u-adm'); // sin identificadores técnicos (G-10)
    expect(screen.getByRole('button', { name: 'Abrir conteo' })).toBeTruthy();
  });
});
