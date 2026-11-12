// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, render, screen, waitFor, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorApi } from '../../api/errores.js';
import { crearEntorno, type Entorno } from '../../ayuda-pruebas.js';
import type { Rol } from '../../api/tipos.js';
import { ProveedorGuardia } from '../../ui/guardia.js';
import { PantallaInventario } from './inventario.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const CABLE = 'Cable HDMI 2 m';
const PARLANTE = 'Parlante portátil';
const ver = (e: Entorno): void => void render(e.envolver(h(ProveedorGuardia, null, h(PantallaInventario, { sub: 'productos' }))));
const nuevoProducto = async (u: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> => {
  await u.click(await screen.findByRole('button', { name: 'Nuevo producto' }));
  return screen.findByRole('dialog', { name: 'Nuevo producto' });
};
const editar = async (u: ReturnType<typeof userEvent.setup>, nombre = CABLE): Promise<HTMLElement> => {
  await u.click(await screen.findByRole('button', { name: `Datos del producto de ${nombre}` }));
  return screen.findByRole('dialog', { name: `Datos del producto: ${nombre}` });
};
const llamadas = (e: Entorno, nombre: string): { entrada: Record<string, unknown> }[] => e.api.llamadas.filter((l) => l.nombre === nombre) as never;
const completarAlta = async (u: ReturnType<typeof userEvent.setup>): Promise<void> => {
  await u.type(screen.getByLabelText(/^Nombre/), 'Teclado mecánico');
  await u.type(screen.getByLabelText(/^Categoría/), 'Accesorios');
  await u.type(screen.getByLabelText(/^SKU/), 'TEC-1');
  await u.type(screen.getByLabelText(/^Bolivia \(USD\)/), '15');
  await u.type(screen.getByLabelText(/^Argentina \(USD\)/), '16');
};

describe('alta en el panel lateral', () => {
  it('abre a la derecha con el foco en el primer campo, sin estilos en línea', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    const d = await nuevoProducto(u);
    expect(d.closest('.dialogo-lateral')).toBeTruthy();
    expect(d.closest('.dialogo-derecha')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/^Nombre/)));
    expect(d.querySelectorAll('[style]').length).toBe(0);
  });

  it('el identificador se sugiere desde el nombre y deja de seguirlo cuando la persona lo edita', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    await nuevoProducto(u);
    await u.type(screen.getByLabelText(/^Nombre/), 'Teclado mecánico');
    expect((screen.getByLabelText(/^Identificador/) as HTMLInputElement).value).toBe('teclado-mecanico');
    await u.clear(screen.getByLabelText(/^Identificador/));
    await u.type(screen.getByLabelText(/^Identificador/), 'mi-codigo');
    await u.type(screen.getByLabelText(/^Nombre/), ' X');
    expect((screen.getByLabelText(/^Identificador/) as HTMLInputElement).value).toBe('mi-codigo');
  });

  it('«Crear producto» nunca se apaga: revisa, marca el error junto a cada campo y enfoca el primero', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    const d = await nuevoProducto(u);
    const boton = within(d).getByRole('button', { name: 'Crear producto' }) as HTMLButtonElement;
    expect(boton.disabled).toBe(false);
    await u.click(boton);
    expect(boton.disabled).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/^Nombre/)));
    expect(screen.getByLabelText(/^Nombre/).getAttribute('aria-invalid')).toBe('true');
    expect(within(d).getByText(/Escriba el nombre del producto/)).toBeTruthy();
    expect(within(d).getByText(/Falta el precio de Bolivia/)).toBeTruthy();
    expect(within(d).getByText(/Falta el precio de Argentina/)).toBeTruthy();
    expect(llamadas(e, 'crearProducto').length).toBe(0);
    // Corregir un campo borra su error y el foco se va al siguiente con error al volver a pulsar.
    await u.type(screen.getByLabelText(/^Nombre/), 'Teclado');
    await u.click(boton);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/^Categoría/)));
  });

  it('crea el producto con un operacionId, avisa, cierra y devuelve el foco al botón de origen', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    await nuevoProducto(u);
    await completarAlta(u);
    await u.click(screen.getByRole('button', { name: 'Crear producto' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Producto creado: Teclado mecánico.')).toBeTruthy();
    const [c] = llamadas(e, 'crearProducto');
    expect(typeof c?.entrada['operacionId']).toBe('string');
    expect(c?.entrada['producto']).toMatchObject({ id: 'teclado-mecanico', sku: 'TEC-1', precioUSD: { bo: 1500, ar: 1600 } });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Nuevo producto' })));
    expect(await screen.findByText('Teclado mecánico')).toBeTruthy();
  });

  it('un error del servidor va al campo que corresponde, con el foco, y el panel sigue abierto', async () => {
    const e = crearEntorno('adm');
    const original = e.api.llamar.bind(e.api);
    vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, en: unknown) => (n === 'crearProducto' ? Promise.reject(new ErrorApi('failed-precondition', 'El sku TEC-1 ya está en uso', { codigo: 'estado-invalido' })) : original(n as never, en as never))) as never);
    ver(e);
    const u = userEvent.setup();
    await nuevoProducto(u);
    await completarAlta(u);
    await u.click(screen.getByRole('button', { name: 'Crear producto' }));
    expect(await screen.findByText(/Ese SKU ya lo usa otro producto/)).toBeTruthy();
    expect(screen.getByLabelText(/^SKU/).getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/^SKU/)));
    expect(screen.getByRole('dialog', { name: 'Nuevo producto' })).toBeTruthy();
  });

  it('un reintento tras un fallo de conexión usa el mismo operacionId', async () => {
    const e = crearEntorno('adm');
    const original = e.api.llamar.bind(e.api);
    const ids: unknown[] = [];
    let fallo = true;
    vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, en: { operacionId?: unknown }) => {
      if (n === 'crearProducto') {
        ids.push(en.operacionId);
        if (fallo) {
          fallo = false;
          return Promise.reject(new ErrorApi('unavailable', 'sin red'));
        }
      }
      return original(n as never, en as never);
    }) as never);
    ver(e);
    const u = userEvent.setup();
    await nuevoProducto(u);
    await completarAlta(u);
    await u.click(screen.getByRole('button', { name: 'Crear producto' }));
    expect(await screen.findByText(/No hay conexión/)).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Crear producto' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(ids.length).toBe(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it('los precios se piden por cada mercado, con ayuda y la conversión del día', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    const d = await nuevoProducto(u);
    expect(within(d).getByText(/Obligatorio en cada mercado/)).toBeTruthy();
    await u.type(screen.getByLabelText(/^Bolivia \(USD\)/), '450');
    expect(d.querySelector('[data-prueba="precio-bo"]')?.textContent).toContain('Bs');
    expect(d.querySelector('[data-prueba="precio-ar"]')?.textContent).toContain('—');
  });
});

describe('edición', () => {
  it('vaciar marca, garantía, mínimo o costo advierte antes de guardar y envía null con un operacionId', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    const d = await editar(u, PARLANTE);
    await u.clear(within(d).getByLabelText('Marca'));
    await u.clear(within(d).getByLabelText(/^Garantía/));
    await u.click(within(d).getByRole('button', { name: 'Guardar cambios' }));
    const aviso = await screen.findByRole('dialog', { name: '¿Guardar estos cambios?' });
    expect(within(aviso).getByText(/Se quitará del producto la marca y la garantía/)).toBeTruthy();
    expect(llamadas(e, 'actualizarProducto').length).toBe(0);
    // «Volver a editar» no guarda nada.
    await u.click(within(aviso).getByRole('button', { name: 'Volver a editar' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '¿Guardar estos cambios?' })).toBeNull());
    expect(llamadas(e, 'actualizarProducto').length).toBe(0);
    await u.click(within(d).getByRole('button', { name: 'Guardar cambios' }));
    await u.click(within(await screen.findByRole('dialog', { name: '¿Guardar estos cambios?' })).getByRole('button', { name: 'Sí, guardar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const [c] = llamadas(e, 'actualizarProducto');
    expect(c?.entrada).toMatchObject({ productoId: 'parlante', cambios: { marca: null, garantiaMeses: null } });
    expect(typeof c?.entrada['operacionId']).toBe('string');
    const p = (await e.api.llamar('listarProductos', {})).find((x) => x.id === 'parlante');
    expect(p?.marca).toBeUndefined();
    expect(await screen.findByText(`Cambios guardados: ${PARLANTE}.`)).toBeTruthy();
  });

  it('desactivar solo advierte: dice qué pasa, que el stock no se pierde, y pide confirmar', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    const d = await editar(u);
    await u.click(within(d).getByLabelText('Activo'));
    expect(within(d).getByText(/deja de venderse en caja y sale del sitio en la siguiente publicación/)).toBeTruthy();
    await u.click(within(d).getByRole('button', { name: 'Guardar cambios' }));
    const aviso = await screen.findByRole('dialog', { name: '¿Guardar estos cambios?' });
    expect(aviso.textContent).toMatch(/deja de venderse en caja/);
    expect(aviso.textContent).toMatch(/sale del sitio en la siguiente publicación/);
    expect(aviso.textContent).toMatch(/El stock no se pierde \(hay 35 en total\)/);
    expect(llamadas(e, 'actualizarProducto').length).toBe(0);
    await u.click(within(aviso).getByRole('button', { name: 'Sí, guardar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(llamadas(e, 'actualizarProducto')[0]?.entrada).toMatchObject({ cambios: { activo: false } });
    expect((await e.api.llamar('listarProductos', {})).find((x) => x.id === 'cable-hdmi')?.stockTotal).toBe(35);
  });

  it('cambiar solo el precio llama a cambiarPrecioUSD con su operacionId y sin advertencia', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    const d = await editar(u);
    await u.clear(within(d).getByLabelText(/^Bolivia \(USD\)/));
    await u.type(within(d).getByLabelText(/^Bolivia \(USD\)/), '10,50');
    await u.click(within(d).getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(llamadas(e, 'actualizarProducto').length).toBe(0);
    const [c] = llamadas(e, 'cambiarPrecioUSD');
    expect(c?.entrada).toMatchObject({ productoId: 'cable-hdmi', precioUSD: { bo: 1050, ar: 900 } });
    expect(typeof c?.entrada['operacionId']).toBe('string');
  });

  it('sin cambios avisa y no llama al servidor (que rechaza un cambio vacío)', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    const d = await editar(u);
    await u.click(within(d).getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('No hay cambios que guardar.')).toBeTruthy();
    expect(llamadas(e, 'actualizarProducto').length).toBe(0);
  });

  it('un valor inválido marca el campo y enfoca; no se envía nada', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    const d = await editar(u);
    await u.clear(within(d).getByLabelText('Mínimo de existencias'));
    await u.type(within(d).getByLabelText('Mínimo de existencias'), '1,5');
    await u.click(within(d).getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(document.activeElement).toBe(within(d).getByLabelText('Mínimo de existencias')));
    expect(within(d).getByText(/Indique un número entero desde 0/)).toBeTruthy();
    expect(llamadas(e, 'actualizarProducto').length).toBe(0);
  });

  it('guardia: con cambios, Cancelar pregunta antes de descartar; sin cambios cierra y devuelve el foco a la fila', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    const d = await editar(u);
    await u.type(within(d).getByLabelText(/^Categoría/), ' y más');
    await u.click(within(d).getByRole('button', { name: 'Cancelar' }));
    const pregunta = await screen.findByRole('dialog', { name: '¿Salir sin guardar?' });
    await u.click(within(pregunta).getByRole('button', { name: 'Seguir editando' }));
    expect(screen.getByRole('dialog', { name: `Datos del producto: ${CABLE}` })).toBeTruthy();
    await u.click(within(d).getByRole('button', { name: 'Cancelar' }));
    await u.click(within(await screen.findByRole('dialog', { name: '¿Salir sin guardar?' })).getByRole('button', { name: 'Salir sin guardar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: `Datos del producto de ${CABLE}` })));
    // El borrador se descartó: al abrir otra vez, el campo vuelve a su valor.
    const otra = await editar(u);
    expect((within(otra).getByLabelText(/^Categoría/) as HTMLInputElement).value).toBe('Accesorios');
  });

  it('Escape con cambios pregunta antes de descartar', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    const d = await editar(u);
    await u.type(within(d).getByLabelText(/^Categoría/), 'x');
    await u.keyboard('{Escape}');
    expect(await screen.findByRole('dialog', { name: '¿Descartar los cambios?' })).toBeTruthy();
  });

  it('el borrador sobrevive al cambio de pestaña dentro del panel', async () => {
    const e = crearEntorno('adm');
    const pantalla = (sub: string): ReturnType<Entorno['envolver']> => e.envolver(h(ProveedorGuardia, null, h(PantallaInventario, { sub })));
    const { rerender } = render(pantalla('productos'));
    const u = userEvent.setup();
    const d = await editar(u);
    await u.type(within(d).getByLabelText(/^Categoría/), ' nueva');
    rerender(pantalla('ingreso'));
    await screen.findByRole('heading', { name: 'Ingreso de mercadería' });
    rerender(pantalla('productos'));
    const otra = await editar(u);
    expect((within(otra).getByLabelText(/^Categoría/) as HTMLInputElement).value).toBe('Accesorios nueva');
  });

  it('el supervisor consulta los datos pero no ve «Guardar» ni el costo', async () => {
    const e = crearEntorno('sup' as Rol);
    ver(e);
    const u = userEvent.setup();
    const d = await editar(u);
    expect(within(d).getByText(/Solo el administrador edita/)).toBeTruthy();
    expect(within(d).queryByRole('button', { name: 'Guardar cambios' })).toBeNull();
    expect(within(d).queryByText(/Costo y margen/)).toBeNull();
    expect(within(d).getAllByRole('button', { name: 'Cerrar' }).length).toBe(2);
  });
});
