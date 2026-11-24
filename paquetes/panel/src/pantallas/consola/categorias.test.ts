// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, render, screen, waitFor, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { crearEntorno } from '../../ayuda-pruebas.js';
import { ErrorApi } from '../../api/errores.js';
import { ProveedorGuardia } from '../../ui/guardia.js';
import { PantallaCatalogo } from './catalogo.js';
import { PantallaCategorias, type ServicioCategorias } from './categorias.js';

afterEach(cleanup);

const NEGOCIO = {
  nombre: 'Tienda Ejemplo', enlacesPermitidos: ['ejemplo.test'], destacados: ['p-1'], textoPrivacidad: ['P'],
  categorias: { 'linea-blanca': { nombre: 'Línea blanca', icono: 'lavadora', orden: 0 } },
};

function servicio(inicial: Record<string, unknown> | null, falla: ErrorApi | null = null): ServicioCategorias & { guardados: { negocio: Record<string, unknown>; version: number }[] } {
  let version = inicial === null ? 0 : 1;
  const guardados: { negocio: Record<string, unknown>; version: number }[] = [];
  return {
    guardados,
    leer: () => Promise.resolve({ negocio: inicial, version }),
    guardar: (negocio, v) => {
      if (falla !== null) return Promise.reject(falla);
      guardados.push({ negocio: negocio as Record<string, unknown>, version: v });
      version += 1;
      return Promise.resolve({ version });
    },
    categoriasDeProductos: () => Promise.resolve(['linea-blanca', 'linea-blanca', 'tv']),
  };
}
const ver = (s: ServicioCategorias): void => void render(crearEntorno('adm').envolver(h(ProveedorGuardia, null, h(PantallaCategorias, { servicio: s }))));

describe('categorías: pantalla', () => {
  it('lista nombre, ícono, productos y estado, incluso las que solo usan los productos', async () => {
    ver(servicio(NEGOCIO));
    const tabla = await screen.findByRole('table', { name: 'Categorías del sitio' });
    const fila = within(tabla).getByRole('row', { name: /Línea blanca/ });
    expect(fila.textContent).toContain('Lavadora');
    expect(fila.textContent).toContain('2');
    expect(fila.textContent).toContain('Visible');
    expect(within(tabla).getByRole('row', { name: /tv/ }).textContent).toContain('Sin nombre propio');
  });

  it('editar abre un panel lateral, guarda con la versión leída y conserva el resto del documento', async () => {
    const s = servicio(NEGOCIO);
    ver(s);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Editar Línea blanca' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Categoría: Línea blanca' });
    expect(dialogo.parentElement?.className).toContain('dialogo-lateral');
    expect(dialogo.textContent).toContain('La dirección de la página no cambia.');
    await u.click(within(dialogo).getByLabelText('Ocultar esta categoría'));
    await u.click(within(dialogo).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(s.guardados).toHaveLength(1));
    expect(s.guardados[0]?.version).toBe(1);
    expect(s.guardados[0]?.negocio).toEqual({ ...NEGOCIO, categorias: { 'linea-blanca': { nombre: 'Línea blanca', icono: 'lavadora', oculta: true, orden: 0 } } });
    await screen.findByText(/Falta publicar el sitio/);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('nueva categoría: avisa cuándo aparece y la crea con su clave', async () => {
    const s = servicio(NEGOCIO);
    ver(s);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Nueva categoría' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Nueva categoría' });
    await u.type(within(dialogo).getByLabelText(/Nombre de la categoría/), 'Cámaras y lentes');
    expect(dialogo.textContent).toContain('Aparece en el sitio cuando un producto la use; en el producto escriba "camaras-y-lentes".');
    await u.click(within(dialogo).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(s.guardados).toHaveLength(1));
    expect((s.guardados[0]?.negocio['categorias'] as Record<string, unknown>)['camaras-y-lentes']).toEqual({ nombre: 'Cámaras y lentes', icono: 'cuadricula' });
  });

  it('un nombre vacío no se guarda y dice qué falta', async () => {
    const s = servicio(NEGOCIO);
    ver(s);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Nueva categoría' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Nueva categoría' });
    await u.click(within(dialogo).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialogo).findByText(/Escriba el nombre de la categoría/)).toBeTruthy();
    expect(s.guardados).toHaveLength(0);
  });

  it('versión vieja: muestra el conflicto y no cierra el panel', async () => {
    ver(servicio(NEGOCIO, new ErrorApi('conflicto', 'Los datos cambiaron desde que los leyó')));
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Editar Línea blanca' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Categoría: Línea blanca' });
    await u.click(within(dialogo).getByLabelText('Ocultar esta categoría'));
    await u.click(within(dialogo).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialogo).findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('subir y bajar reordenan guardando el orden', async () => {
    const s = servicio({ ...NEGOCIO, categorias: { ...NEGOCIO.categorias, tv: { nombre: 'Televisores', icono: 'televisor', orden: 1 } } });
    ver(s);
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Subir Televisores' }));
    await waitFor(() => expect(s.guardados).toHaveLength(1));
    expect(s.guardados[0]?.negocio['categorias']).toEqual({ 'linea-blanca': { nombre: 'Línea blanca', icono: 'lavadora', orden: 1 }, tv: { nombre: 'Televisores', icono: 'televisor', orden: 0 } });
  });

  it('sin datos del sitio guardados: pide completar primero Textos del sitio', async () => {
    ver(servicio(null));
    expect(await screen.findByText(/Primero complete Textos del sitio/)).toBeTruthy();
  });
});

describe('categorías: pestaña según el rol', () => {
  it('el administrador ve la pestaña; el supervisor no', async () => {
    for (const [rol, esperado] of [['adm', true], ['sup', false]] as const) {
      const e = crearEntorno(rol);
      render(e.envolver(h(ProveedorGuardia, null, h(PantallaCatalogo, { sub: 'categorias' }))));
      await screen.findByRole('heading', { name: 'Catálogo y sitio' });
      expect(screen.queryByRole('link', { name: 'Categorías' }) !== null, rol).toBe(esperado);
      if (esperado) await screen.findByRole('heading', { name: 'Categorías' });
      else expect(screen.queryByRole('heading', { name: 'Categorías' })).toBeNull();
      cleanup();
    }
  });
});
