// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorApi } from '../../api/errores.js';
import { crearEntorno, type Entorno } from '../../ayuda-pruebas.js';
import { ProveedorGuardia } from '../../ui/guardia.js';
import { PantallaFichas } from './catalogo-ficha.js';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  document.documentElement.className = '';
});

const TV = 'Televisor 55 pulgadas';
const CABLE = 'Cable HDMI 2 m';
const ver = (e: Entorno): void => void render(e.envolver(h(ProveedorGuardia, null, h(PantallaFichas, null))));
const jpg = (nombre: string, bytes = 2048): File => new File(['x'.repeat(bytes)], nombre, { type: 'image/jpeg' });
const fotos = (): HTMLElement => screen.getByLabelText('Archivos de fotos');
const video = (): HTMLElement => screen.getByLabelText('Archivo de video');
/** El botón único de la fila: «Preparar para el sitio» sin página y «Editar página» con ella. */
const botonFilaYa = (producto: string): HTMLElement => screen.getByRole('button', { name: new RegExp(`^(Editar página|Preparar para el sitio|Mostrar en el sitio) de ${producto}$`) });
const botonFila = (producto: string): Promise<HTMLElement> => screen.findByRole('button', { name: new RegExp(`^(Editar página|Preparar para el sitio|Mostrar en el sitio) de ${producto}$`) });
const abrir = async (u: ReturnType<typeof userEvent.setup>, _boton: string, producto: string): Promise<HTMLElement> => {
  await u.click(await botonFila(producto));
  return screen.findByRole('dialog', { name: `Página en el sitio: ${producto}` });
};
const guardados = (e: Entorno): number => e.api.llamadas.filter((l) => l.nombre === 'guardarFicha').length;

describe('lista de páginas de producto', () => {
  it('es una tabla con búsqueda, la cantidad en la ficha y un solo botón por fila', async () => {
    const e = crearEntorno('sup');
    ver(e);
    const tabla = await screen.findByRole('table', { name: 'Productos y su página en el sitio' });
    expect(within(tabla).getByRole('columnheader', { name: 'Fotos y video' })).toBeTruthy();
    expect(within(tabla).getAllByText('0 en la ficha').length).toBeGreaterThan(0);
    // Sin página, la fila ofrece solo «Preparar para el sitio»; con ella, solo «Editar página»: nunca los dos.
    const sinPagina = within(tabla).getByRole('row', { name: new RegExp(TV) });
    expect(within(sinPagina).getAllByRole('button').map((b) => b.textContent)).toEqual(['Preparar para el sitio']);
    const u = userEvent.setup();
    await u.type(screen.getByLabelText('Buscar producto'), 'hdmi');
    expect(within(tabla).queryByText(TV)).toBeNull();
    expect(within(tabla).getByText(CABLE)).toBeTruthy();
    await e.api.llamar('guardarFicha', { productoId: 'tv-55', ficha: { slug: 'tv-55', descripcion: 'x', garantia: '', medios: [], seo: { titulo: '', descripcion: '' }, estado: 'borrador' } });
    cleanup();
    ver(e);
    const tabla2 = await screen.findByRole('table', { name: 'Productos y su página en el sitio' });
    const conPagina = await within(tabla2).findByRole('row', { name: new RegExp(`${TV}.*Falta`) });
    expect(within(conPagina).getAllByRole('button').map((b) => b.textContent)).toEqual(['Editar página']);
  });
});

describe('panel lateral de la ficha', () => {
  it('«Editar página» abre el panel con las dos secciones y Cancelar devuelve el foco a la fila', async () => {
    const e = crearEntorno('sup');
    ver(e);
    const u = userEvent.setup();
    const dialogo = await abrir(u, 'Editar página', TV);
    expect(within(dialogo).getByRole('heading', { name: `Página en el sitio: ${TV}` })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(within(dialogo).getByLabelText(/Dirección de la página/)), { timeout: 3000 });
    // La zona de carga y los medios van antes que los textos.
    const orden = Array.from(dialogo.querySelectorAll('h3')).map((x) => x.textContent);
    expect(orden).toEqual(['Fotos y video', 'Textos de la página']);
    await u.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 3000 });
    await waitFor(() => expect(document.activeElement).toBe(botonFilaYa(TV)), { timeout: 3000 });
  });
  it('«Editar página» deja el foco en la dirección', async () => {
    const e = crearEntorno('sup');
    ver(e);
    const u = userEvent.setup();
    await abrir(u, 'Editar página', TV);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/Dirección de la página/)), { timeout: 3000 });
  });

  it('sube una foto con progreso, la guarda sola, la guarda con su descripción y respeta el tope de 5', async () => {
    const e = crearEntorno('sup');
    ver(e);
    const u = userEvent.setup();
    await abrir(u, 'Editar página', TV);
    fireEvent.change(await screen.findByLabelText('Archivos de fotos'), { target: { files: [jpg('frente.jpg')] } });
    expect(await screen.findByText('frente.jpg: Listo')).toBeTruthy();
    expect(e.almacen.subidos).toHaveLength(1);
    expect(e.almacen.subidos[0]?.ruta).toContain('privado/tv-55/');
    // El disparador resolvió la subida: el panel solo consultó el estado, sin forzar el procesamiento.
    expect(e.api.llamadas.some((l) => l.nombre === 'estadoSubida')).toBe(true);
    expect(e.api.llamadas.some((l) => l.nombre === 'finalizarSubida')).toBe(false);
    // Se identifica por posición, medidas y descripción sugerida.
    expect(await screen.findByText(/Foto 1 \(portada\)/)).toBeTruthy();
    expect(screen.getByText(/1200 × 800 · 2 KB/)).toBeTruthy();
    expect((screen.getByLabelText('Descripción de la foto 1') as HTMLInputElement).value).toBe(`${TV}, foto 1`);
    // Guardado automático de la lista, sin esperar a «Guardar».
    await waitFor(() => expect(guardados(e)).toBe(1), { timeout: 3000 });
    expect((await e.api.llamar('listarFichas', {}))[0]?.ficha.medios[0]?.alt).toBe(`${TV}, foto 1`);
    await u.clear(screen.getByLabelText('Descripción de la foto 1'));
    await u.type(screen.getByLabelText('Descripción de la foto 1'), 'frente');
    await u.type(screen.getByLabelText('Descripción del producto'), 'Televisor de 55 pulgadas.');
    await u.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText(/Página guardada/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 3000 });
    expect((await e.api.llamar('listarFichas', {}))[0]?.ficha.medios[0]?.alt).toBe('frente');
    await waitFor(() => expect(document.activeElement).toBe(botonFilaYa(TV)), { timeout: 3000 });
  });
  it('existente: al guardar envía solo los campos editables, sin los de almacenamiento', async () => {
    const e = crearEntorno('sup');
    const guardada = { slug: 'tv-55', descripcion: 'Televisor.', garantia: '12 meses', medios: [], seo: { titulo: 'Televisor', descripcion: '' }, estado: 'borrador', productoId: 'tv-55', version: 3, actualizadaEn: 'ayer', por: 'u1' };
    await e.api.llamar('guardarFicha', { productoId: 'tv-55', ficha: guardada as never });
    e.api.llamadas.length = 0;
    ver(e);
    const u = userEvent.setup();
    await abrir(u, 'Editar página', TV);
    await u.type(await screen.findByLabelText('Descripción del producto'), ' Nuevo.');
    await u.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText(/Página guardada/)).toBeTruthy();
    const envio = e.api.llamadas.find((l) => l.nombre === 'guardarFicha');
    expect(Object.keys((envio?.entrada as { ficha: object }).ficha).sort()).toEqual(['descripcion', 'estado', 'garantia', 'medios', 'seo', 'slug']);
  });
  it('si el servidor rechaza el archivo, muestra su motivo con «Elegir otro archivo», sin «Reintentar», y no agrega el medio', async () => {
    const e = crearEntorno('sup');
    e.api.estado.disparador.rechazo = 'El archivo no es una imagen válida';
    ver(e);
    const u = userEvent.setup();
    await abrir(u, 'Editar página', TV);
    fireEvent.change(await screen.findByLabelText('Archivos de fotos'), { target: { files: [jpg('roto.jpg', 1)] } });
    expect(await screen.findByText('roto.jpg: El archivo no es una imagen válida')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Elegir otro archivo en lugar de roto.jpg' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Reintentar/ })).toBeNull();
    expect(e.api.llamadas.some((l) => l.nombre === 'finalizarSubida')).toBe(false);
    expect(await e.api.llamar('listarMedios', { productoId: 'tv-55' })).toHaveLength(0);
    expect(guardados(e)).toBe(0);
  });
  it('un video, reordenar y quitar de la ficha', async () => {
    const e = crearEntorno('sup');
    ver(e);
    const u = userEvent.setup();
    await abrir(u, 'Editar página', CABLE);
    fireEvent.change(await screen.findByLabelText('Archivos de fotos'), { target: { files: [jpg('uno.jpg', 1), jpg('dos.jpg', 1)] } });
    await screen.findByText('uno.jpg: Listo');
    await screen.findByText('dos.jpg: Listo');
    // jsdom no tiene decodificador: la duración se lee de los bytes (aquí no son un video válido) y decide el servidor.
    fireEvent.change(video(), { target: { files: [new File(['v'], 'demo.mp4', { type: 'video/mp4' })] } });
    await screen.findByText('demo.mp4: Listo');
    await waitFor(() => expect(screen.getByText('Ya hay un video')).toBeTruthy());
    const primero = screen.getByLabelText('Descripción de la foto 1') as HTMLInputElement;
    const textoAntes = primero.value;
    await u.click(screen.getByRole('button', { name: 'Mover abajo el medio 1' }));
    expect((screen.getByLabelText('Descripción de la foto 2') as HTMLInputElement).value).toBe(textoAntes);
    await u.click(screen.getByRole('button', { name: 'Quitar de la ficha el medio 1' }));
    expect(screen.queryByLabelText('Descripción del video')).toBeTruthy();
    expect(screen.getAllByRole('listitem').filter((li) => li.classList.contains('ficha-medio'))).toHaveLength(2);
  });
  it('un archivo demasiado grande se informa sin romper la pantalla', async () => {
    const e = crearEntorno('sup');
    ver(e);
    const u = userEvent.setup();
    await abrir(u, 'Editar página', CABLE);
    const enorme = jpg('gigante.jpg', 1);
    Object.defineProperty(enorme, 'size', { value: 16 * 1024 * 1024 });
    fireEvent.change(await screen.findByLabelText('Archivos de fotos'), { target: { files: [enorme] } });
    expect(await screen.findByText(/^La foto «gigante.jpg» pesa 16,0 MB y el máximo es 15,0 MB/)).toBeTruthy();
  });

  it('el cupo libre descuenta lo ya subido al producto: caben las que faltan y se dice cuántas quedaron fuera', async () => {
    const e = crearEntorno('sup');
    for (const id of ['medio-previo-1', 'medio-previo-2']) e.api.estado.medios.set(id, { id, productoId: 'tv-55', tipo: 'foto', bytesOriginal: 1000, ancho: 800, alto: 600, creadoEn: 1, por: 'u' });
    ver(e);
    const u = userEvent.setup();
    await abrir(u, 'Editar página', TV);
    // Archivos que ya estaban subidos y no están en la página.
    expect(await screen.findByText(/Archivos subidos que no están en la página/)).toBeTruthy();
    fireEvent.change(await screen.findByLabelText('Archivos de fotos'), { target: { files: [jpg('a.jpg', 1), jpg('b.jpg', 1), jpg('c.jpg', 1), jpg('d.jpg', 1), jpg('e.jpg', 1)] } });
    expect(await screen.findByText(/Se suben 3 fotos y 2 fotos quedaron fuera: el máximo es 5 fotos por producto/)).toBeTruthy();
    await screen.findByText('c.jpg: Listo');
    expect(e.almacen.subidos).toHaveLength(3);
    await waitFor(() => expect(screen.getByText('Ya hay 5 fotos')).toBeTruthy());
    fireEvent.change(fotos(), { target: { files: [jpg('f.jpg', 1)] } });
    expect(await screen.findByText(/No se subió 1 foto: el máximo es 5 fotos por producto y ya no queda lugar/)).toBeTruthy();
    expect(e.almacen.subidos).toHaveLength(3);
  });
  it('«Reintentar» aparece solo en una falla de subida y repite con el mismo identificador', async () => {
    const e = crearEntorno('sup');
    const original = e.almacen.subir.bind(e.almacen);
    let intentos = 0;
    e.almacen.subir = async (ruta, archivo, alProgresar) => {
      intentos += 1;
      if (intentos === 1) throw new Error('sin red');
      return original(ruta, archivo, alProgresar);
    };
    ver(e);
    const u = userEvent.setup();
    await abrir(u, 'Editar página', TV);
    fireEvent.change(await screen.findByLabelText('Archivos de fotos'), { target: { files: [jpg('red.jpg')] } });
    const boton = await screen.findByRole('button', { name: 'Reintentar la subida de red.jpg' });
    expect(screen.queryByRole('button', { name: /Elegir otro archivo en lugar/ })).toBeNull();
    await u.click(boton);
    await screen.findByText('red.jpg: Listo');
    const reservas = e.api.llamadas.filter((l) => l.nombre === 'reservarSubida').map((l) => (l.entrada as { subidaId: string }).subidaId);
    expect(reservas).toHaveLength(2);
    expect(reservas[0]).toBe(reservas[1]);
  });
  it('el servicio no disponible durante la reserva también permite reintentar', async () => {
    const e = crearEntorno('sup');
    const llamar = e.api.llamar.bind(e.api);
    let falla = true;
    vi.spyOn(e.api, 'llamar').mockImplementation(((nombre: string, entrada: never) => {
      if (nombre === 'reservarSubida' && falla) {
        falla = false;
        return Promise.reject(new ErrorApi('unavailable', 'sin conexión'));
      }
      return llamar(nombre as never, entrada);
    }) as never);
    ver(e);
    const u = userEvent.setup();
    await abrir(u, 'Editar página', TV);
    fireEvent.change(await screen.findByLabelText('Archivos de fotos'), { target: { files: [jpg('a.jpg')] } });
    await u.click(await screen.findByRole('button', { name: 'Reintentar la subida de a.jpg' }));
    await screen.findByText('a.jpg: Listo');
  });
  it('muestra los segundos mientras el servidor procesa', async () => {
    const e = crearEntorno('sup');
    e.api.estado.disparador.demoraMs = 1500;
    ver(e);
    const u = userEvent.setup();
    await abrir(u, 'Editar página', TV);
    fireEvent.change(await screen.findByLabelText('Archivos de fotos'), { target: { files: [jpg('lenta.jpg')] } });
    expect(await screen.findByText(/Procesando en el servidor… [1-9] s/, undefined, { timeout: 3000 })).toBeTruthy();
    await screen.findByText('lenta.jpg: Listo', undefined, { timeout: 5000 });
  }, 10_000);
  it('dos subidas seguidas se guardan una tras otra y la ficha queda con las dos', async () => {
    const e = crearEntorno('sup');
    ver(e);
    const u = userEvent.setup();
    await abrir(u, 'Editar página', TV);
    fireEvent.change(await screen.findByLabelText('Archivos de fotos'), { target: { files: [jpg('uno.jpg', 1), jpg('dos.jpg', 1)] } });
    await screen.findByText('uno.jpg: Listo');
    await screen.findByText('dos.jpg: Listo');
    await waitFor(async () => expect((await e.api.llamar('listarFichas', {}))[0]?.ficha.medios).toHaveLength(2));
    expect(guardados(e)).toBeGreaterThanOrEqual(2);
  });
  it('el guardado automático guarda la lista de medios pero no los textos sin guardar', async () => {
    const e = crearEntorno('sup');
    ver(e);
    const u = userEvent.setup();
    await abrir(u, 'Editar página', TV);
    await u.type(await screen.findByLabelText('Descripción del producto'), 'Texto sin guardar');
    fireEvent.change(fotos(), { target: { files: [jpg('uno.jpg', 1)] } });
    await screen.findByText('uno.jpg: Listo');
    await waitFor(async () => expect((await e.api.llamar('listarFichas', {}))[0]?.ficha.medios).toHaveLength(1));
    expect((await e.api.llamar('listarFichas', {}))[0]?.ficha.descripcion).toBe('');
    expect((screen.getByLabelText('Descripción del producto') as HTMLTextAreaElement).value).toBe('Texto sin guardar');
  });
  it('el guardado automático no envía ediciones locales: solo agrega el medio nuevo sobre lo confirmado, y Cancelar las revierte', async () => {
    const e = crearEntorno('sup');
    ver(e);
    const u = userEvent.setup();
    await abrir(u, 'Editar página', TV);
    fireEvent.change(await screen.findByLabelText('Archivos de fotos'), { target: { files: [jpg('uno.jpg', 1)] } });
    await screen.findByText('uno.jpg: Listo');
    await waitFor(() => expect(guardados(e)).toBe(1));
    await screen.findByLabelText('Descripción de la foto 1');
    await u.clear(screen.getByLabelText('Descripción de la foto 1'));
    await u.type(screen.getByLabelText('Descripción de la foto 1'), 'editada sin guardar');
    fireEvent.change(fotos(), { target: { files: [jpg('dos.jpg', 1)] } });
    await screen.findByText('dos.jpg: Listo');
    await waitFor(() => expect(guardados(e)).toBe(2));
    const medios = (await e.api.llamar('listarFichas', {}))[0]?.ficha.medios ?? [];
    expect(medios).toHaveLength(2);
    expect(medios[0]?.alt).toBe(`${TV}, foto 1`);
    // Lo local sigue en pantalla junto con el medio nuevo.
    expect((screen.getByLabelText('Descripción de la foto 1') as HTMLInputElement).value).toBe('editada sin guardar');
    expect(screen.getByLabelText('Descripción de la foto 2')).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Cancelar' }));
    await u.click(await screen.findByRole('button', { name: 'Salir sin guardar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await abrir(u, 'Editar página', TV);
    expect((await screen.findByLabelText('Descripción de la foto 1') as HTMLInputElement).value).toBe(`${TV}, foto 1`);
  });
  it('una subida que termina entre «Guardar» y la recarga no pisa lo recién guardado', async () => {
    const e = crearEntorno('sup');
    e.api.estado.disparador.demoraMs = 900;
    ver(e);
    const u = userEvent.setup();
    await abrir(u, 'Editar página', TV);
    fireEvent.change(await screen.findByLabelText('Archivos de fotos'), { target: { files: [jpg('lenta.jpg', 1)] } });
    await screen.findAllByText(/Procesando en el servidor/);
    await u.type(screen.getByLabelText('Descripción del producto'), 'Texto nuevo.');
    // La recarga posterior al guardado tarda: la subida termina antes de que llegue.
    const llamar = e.api.llamar.bind(e.api);
    vi.spyOn(e.api, 'llamar').mockImplementation((async (nombre: string, entrada: never) => {
      const r = await llamar(nombre as never, entrada);
      if (nombre === 'listarFichas') await new Promise((ok) => setTimeout(ok, 800));
      return r;
    }) as never);
    await u.click(screen.getByRole('button', { name: 'Guardar' }));
    await screen.findByText(/Página guardada/);
    await screen.findByText('lenta.jpg: Listo', undefined, { timeout: 4000 });
    await waitFor(async () => expect((await e.api.llamar('listarFichas', {}))[0]?.ficha.medios).toHaveLength(1), { timeout: 4000 });
    const f = (await e.api.llamar('listarFichas', {}))[0]?.ficha;
    expect(f?.descripcion).toBe('Texto nuevo.');
    expect((screen.getByLabelText('Descripción del producto') as HTMLTextAreaElement).value).toBe('Texto nuevo.');
  }, 15_000);
  it('dos subidas que terminan antes de confirmarse la primera reciben descripciones distintas', async () => {
    const e = crearEntorno('sup');
    ver(e);
    const u = userEvent.setup();
    await abrir(u, 'Editar página', TV);
    const llamar = e.api.llamar.bind(e.api);
    vi.spyOn(e.api, 'llamar').mockImplementation((async (nombre: string, entrada: never) => {
      if (nombre === 'guardarFicha') await new Promise((ok) => setTimeout(ok, 600));
      return llamar(nombre as never, entrada);
    }) as never);
    fireEvent.change(await screen.findByLabelText('Archivos de fotos'), { target: { files: [jpg('uno.jpg', 1), jpg('dos.jpg', 1)] } });
    await screen.findByText('uno.jpg: Listo');
    await screen.findByText('dos.jpg: Listo');
    const alts = [1, 2].map((n) => (screen.getByLabelText(`Descripción de la foto ${String(n)}`) as HTMLInputElement).value);
    expect(new Set(alts).size).toBe(2);
    await waitFor(async () => expect((await e.api.llamar('listarFichas', {}))[0]?.ficha.medios.map((m) => m.alt).sort()).toEqual([`${TV}, foto 1`, `${TV}, foto 2`]), { timeout: 4000 });
  });
  it('si el guardado automático falla después de un «Guardar», el medio no se pierde: avisa y se puede agregar de nuevo', async () => {
    const e = crearEntorno('sup');
    e.api.estado.disparador.demoraMs = 900;
    ver(e);
    const u = userEvent.setup();
    await abrir(u, 'Editar página', TV);
    fireEvent.change(await screen.findByLabelText('Archivos de fotos'), { target: { files: [jpg('lenta.jpg', 1)] } });
    await screen.findAllByText(/Procesando en el servidor/);
    await u.click(screen.getByRole('button', { name: 'Guardar' }));
    await screen.findByText(/Página guardada/);
    const llamar = e.api.llamar.bind(e.api);
    let falla = true;
    vi.spyOn(e.api, 'llamar').mockImplementation((async (nombre: string, entrada: never) => {
      if (nombre === 'guardarFicha' && falla) throw new ErrorApi('internal', 'Sin conexión.');
      return llamar(nombre as never, entrada);
    }) as never);
    await screen.findByText('lenta.jpg: Listo', undefined, { timeout: 4000 });
    expect(await screen.findByText(/No se pudo guardar la lista de fotos/)).toBeTruthy();
    expect((await e.api.llamar('listarFichas', {}))[0]?.ficha.medios ?? []).toHaveLength(0);
    // El medio sigue a la vista, en la página o en «subidos, no en la página».
    const agregar = screen.queryByRole('button', { name: /Agregar a la página/ });
    if (agregar === null) expect(screen.getByLabelText('Descripción de la foto 1')).toBeTruthy();
    else await u.click(agregar);
    falla = false;
    await u.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(async () => expect((await e.api.llamar('listarFichas', {}))[0]?.ficha.medios).toHaveLength(1), { timeout: 4000 });
  }, 15_000);
  it('con una subida en curso, Cancelar pregunta; al salir se abandona y no se guarda nada con el panel cerrado', async () => {
    const e = crearEntorno('sup');
    e.api.estado.disparador.demoraMs = 700;
    ver(e);
    const u = userEvent.setup();
    await abrir(u, 'Editar página', TV);
    fireEvent.change(await screen.findByLabelText('Archivos de fotos'), { target: { files: [jpg('uno.jpg', 1)] } });
    await screen.findAllByText(/Procesando en el servidor/);
    await u.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByRole('dialog', { name: '¿Salir sin guardar?' })).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Salir sin guardar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await new Promise((r) => setTimeout(r, 1800));
    expect(guardados(e)).toBe(0);
  }, 10_000);
  it('si falla la recarga tras un guardado, conserva lo que se ve y ofrece «Reintentar»', async () => {
    const e = crearEntorno('sup');
    ver(e);
    const u = userEvent.setup();
    await abrir(u, 'Editar página', TV);
    await screen.findByRole('button', { name: 'Elegir fotos' });
    const llamar = e.api.llamar.bind(e.api);
    vi.spyOn(e.api, 'llamar').mockImplementation(((nombre: string, entrada: never) =>
      nombre === 'listarMedios' ? Promise.reject(new ErrorApi('unavailable', 'sin conexión')) : llamar(nombre as never, entrada)) as never);
    fireEvent.change(fotos(), { target: { files: [jpg('uno.jpg', 1)] } });
    await screen.findByText('uno.jpg: Listo');
    expect(await screen.findByText(/No se pudo actualizar/)).toBeTruthy();
    expect(screen.getByLabelText('Descripción de la foto 1')).toBeTruthy();
  });

  it('«Guardar» nunca está apagado: marca el error junto al campo y enfoca el primero', async () => {
    const e = crearEntorno('sup');
    ver(e);
    const u = userEvent.setup();
    await abrir(u, 'Editar página', TV);
    const slug = await screen.findByLabelText(/Dirección de la página/);
    await u.clear(slug);
    await u.type(slug, 'Mala Idea');
    const guardar = screen.getByRole('button', { name: 'Guardar' });
    expect(guardar.hasAttribute('disabled')).toBe(false);
    await u.click(guardar);
    expect(await screen.findByText(/Error: Use minúsculas, números y guiones/)).toBeTruthy();
    expect(slug.getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(slug));
    expect(guardados(e)).toBe(0);
    // Publicar sin descripción también se marca, en su campo.
    await u.clear(slug);
    await u.type(slug, 'tv-55');
    await u.click(screen.getByRole('radio', { name: 'Visible en el sitio' }));
    await u.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText(/Para publicar la página, escriba la descripción/)).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/Descripción del producto/)));
    expect(guardados(e)).toBe(0);
  });
  it('si el servidor dice que la dirección ya está en uso, el error va al campo de la dirección', async () => {
    const e = crearEntorno('sup');
    await e.api.llamar('guardarFicha', { productoId: 'cable-hdmi', ficha: { slug: 'tv-nuevo', descripcion: '', garantia: '', medios: [], seo: { titulo: '', descripcion: '' }, estado: 'borrador' } });
    ver(e);
    const u = userEvent.setup();
    await abrir(u, 'Editar página', TV);
    const slug = await screen.findByLabelText(/Dirección de la página/);
    await u.clear(slug);
    await u.type(slug, 'tv-nuevo');
    await u.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText(/Error: Esa dirección ya la usa la página de otro producto/)).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(slug));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('con cambios sin guardar, Cancelar y la X preguntan; sin ellos cierran directo; descartar borra el borrador', async () => {
    const e = crearEntorno('sup');
    ver(e);
    const u = userEvent.setup();
    await abrir(u, 'Editar página', TV);
    await u.type(await screen.findByLabelText('Descripción del producto'), 'Algo');
    await u.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByRole('dialog', { name: '¿Salir sin guardar?' })).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Seguir editando' }));
    expect((screen.getByLabelText('Descripción del producto') as HTMLTextAreaElement).value).toBe('Algo');
    await u.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(await screen.findByRole('dialog', { name: '¿Descartar los cambios?' })).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Descartar cambios' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(guardados(e)).toBe(0);
    await abrir(u, 'Editar página', TV);
    expect((await screen.findByLabelText('Descripción del producto') as HTMLTextAreaElement).value).toBe('');
  });
  it('un enlace interno con cambios sin guardar pregunta antes de salir', async () => {
    const e = crearEntorno('sup');
    window.location.hash = '#/consola';
    render(e.envolver(h(ProveedorGuardia, null, h('div', null, h('a', { href: '#/otra' }, 'Otra pantalla'), h(PantallaFichas, null)))));
    const u = userEvent.setup();
    await abrir(u, 'Editar página', TV);
    await u.type(await screen.findByLabelText('Descripción del producto'), 'Algo');
    // El panel deja inerte el fondo: el enlace se activa por código, como lo haría una pulsación.
    (document.querySelector('a[href="#/otra"]') as HTMLElement).click();
    expect(await screen.findByRole('dialog', { name: '¿Salir sin guardar?' })).toBeTruthy();
    expect(window.location.hash).toBe('#/consola');
    window.location.hash = '';
  });
});

describe('«Qué falta» por producto', () => {
  const fichaBase = { slug: 'tv-55', descripcion: '', garantia: '', medios: [], seo: { titulo: '', descripcion: '' }, estado: 'borrador' as const };

  it('sin página, la fila dice qué falta y el botón abre la página para crearla', async () => {
    const e = crearEntorno('sup');
    ver(e);
    const u = userEvent.setup();
    const tabla = await screen.findByRole('table', { name: 'Productos y su página en el sitio' });
    expect(within(tabla).getAllByText('Aún no está en el sitio').length).toBeGreaterThan(0);
    await abrir(u, 'Preparar para el sitio', TV);
    expect(await screen.findByLabelText(/Dirección de la página/)).toBeTruthy();
  });

  it('el siguiente paso sigue a la ficha: descripción, fotos y mostrar en el sitio', async () => {
    const e = crearEntorno('sup');
    await e.api.llamar('guardarFicha', { productoId: 'tv-55', ficha: { ...fichaBase, descripcion: 'Pantalla grande' } });
    ver(e);
    const u = userEvent.setup();
    // Un solo botón por fila: abre la página en el primer paso que falta (aquí, las fotos).
    const boton = await botonFila(TV);
    expect(boton.textContent).toBe('Editar página');
    await u.click(boton);
    await screen.findByRole('dialog', { name: `Página en el sitio: ${TV}` });
    await waitFor(() => expect(document.activeElement?.closest('.ficha-zona')).not.toBeNull());
  });

  it('una página completa dice «Completa» y no ofrece paso; nunca afirma que ya salió en el sitio', async () => {
    const e = crearEntorno('sup');
    const r = await e.api.llamar('reservarSubida', { subidaId: crypto.randomUUID(), productoId: 'tv-55', tipo: 'foto', bytes: 10 });
    const m = await e.api.llamar('finalizarSubida', { subidaId: r.subidaId });
    await e.api.llamar('guardarFicha', { productoId: 'tv-55', ficha: { ...fichaBase, descripcion: 'Pantalla grande', medios: [{ medioId: m.id, alt: 'Frente' }], estado: 'publicado' } });
    ver(e);
    await screen.findByText('Completa');
    expect(screen.queryByText(/ya sali|ya est[aá] en el sitio/i)).toBeNull();
  });

  it('el filtro acota a «Sin página», «Borrador» y «Sin fotos»', async () => {
    const e = crearEntorno('sup');
    await e.api.llamar('guardarFicha', { productoId: 'tv-55', ficha: fichaBase });
    ver(e);
    const u = userEvent.setup();
    const tabla = await screen.findByRole('table', { name: 'Productos y su página en el sitio' });
    await u.selectOptions(screen.getByLabelText('Mostrar'), 'borrador');
    expect(within(tabla).getByText(TV)).toBeTruthy();
    expect(within(tabla).queryByText(CABLE)).toBeNull();
    await u.selectOptions(screen.getByLabelText('Mostrar'), 'sin-pagina');
    expect(within(tabla).queryByText(TV)).toBeNull();
    expect(within(tabla).getByText(CABLE)).toBeTruthy();
  });

  it('si el Tablero falla, la lista sigue y no aparece el aviso de cambios sin publicar', async () => {
    const e = crearEntorno('sup');
    await e.api.llamar('guardarFicha', { productoId: 'tv-55', ficha: fichaBase });
    const llamar = e.api.llamar.bind(e.api) as (n: string, x: unknown) => Promise<unknown>;
    vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, x: unknown) => (n === 'obtenerTablero' ? Promise.reject(new ErrorApi('unavailable', 'sin conexión')) : llamar(n, x))) as never);
    ver(e);
    expect(await screen.findByRole('table', { name: 'Productos y su página en el sitio' })).toBeTruthy();
    expect(document.querySelector('[data-prueba="sin-publicar"]')).toBeNull();
    expect(screen.queryByText(/0 cambios sin publicar/)).toBeNull();
  });

  it('avisa los cambios sin publicar con enlace al Tablero', async () => {
    const e = crearEntorno('sup');
    ver(e);
    await screen.findByRole('table', { name: 'Productos y su página en el sitio' });
    expect(document.querySelector('[data-prueba="sin-publicar"]')).toBeNull();
    cleanup();
    await e.api.llamar('guardarFicha', { productoId: 'tv-55', ficha: fichaBase });
    ver(e);
    const aviso = await waitFor(() => {
      const x = document.querySelector('[data-prueba="sin-publicar"]');
      if (x === null) throw new Error('falta');
      return x;
    });
    expect(aviso.textContent).toMatch(/cambio.? sin publicar/);
    expect(within(aviso as HTMLElement).getByRole('link', { name: 'Ver el Tablero' }).getAttribute('href')).toBe('#/catalogo/tablero');
  });
});

describe('estado de la página en el sitio', () => {
  it('«En el sitio» va arriba como opciones visibles; sus textos no usan el verbo de publicar el sitio; el valor guardado no cambia', async () => {
    const e = crearEntorno('sup');
    ver(e);
    const u = userEvent.setup();
    const dialogo = await abrir(u, 'Editar página', TV);
    const grupo = await within(dialogo).findByRole('group', { name: 'En el sitio' });
    expect(within(grupo).getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual(['borrador', 'publicado', 'oculto']);
    expect(within(grupo).getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual(['Borrador', 'Visible en el sitio', 'Oculto']);
    expect((within(grupo).getByRole('radio', { name: 'Borrador' }) as HTMLInputElement).checked).toBe(true);
    // Va antes que las fotos.
    expect(grupo.compareDocumentPosition(dialogo.querySelector('#ficha-medios-titulo') as Element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await u.type(screen.getByLabelText('Descripción del producto'), 'Pantalla grande');
    await u.click(within(grupo).getByRole('radio', { name: 'Visible en el sitio' }));
    await u.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(guardados(e)).toBe(1));
    expect((await e.api.llamar('listarFichas', {}))[0]?.ficha.estado).toBe('publicado');
  });

  it('con solo la visibilidad pendiente, el botón único dice «Mostrar en el sitio» y abre la página con «Visible en el sitio» marcado', async () => {
    const e = crearEntorno('sup');
    e.api.estado.medios.set('m-tv', { id: 'm-tv', productoId: 'tv-55', tipo: 'foto', bytesOriginal: 1000, ancho: 800, alto: 600, creadoEn: 1, por: 'u' });
    await e.api.llamar('guardarFicha', { productoId: 'tv-55', ficha: { slug: 'tv-55', descripcion: 'Pantalla', garantia: '', medios: [{ medioId: 'm-tv', alt: 'Frente' }], seo: { titulo: '', descripcion: '' }, estado: 'borrador' } });
    ver(e);
    const u = userEvent.setup();
    const boton = await botonFila(TV);
    expect(boton.textContent).toBe('Mostrar en el sitio');
    await u.click(boton);
    await screen.findByRole('dialog', { name: `Página en el sitio: ${TV}` });
    await waitFor(() => expect((screen.getByRole('radio', { name: 'Visible en el sitio' }) as HTMLInputElement).checked).toBe(true));
    await u.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(guardados(e)).toBe(2));
    expect((await e.api.llamar('listarFichas', {}))[0]?.ficha.estado).toBe('publicado');
  });
});

const BASE_MEDIOS = 'https://medios.ejemplo.test';
/** Hace que `listarMedios` entregue versiones WebP, como el servidor tras procesar la foto. */
const conVersiones = (e: Entorno): void => {
  const original = e.api.llamar.bind(e.api) as (n: string, d: unknown) => Promise<unknown>;
  vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, d: unknown) =>
    original(n, d).then((r) => (n === 'listarMedios' ? (r as { id: string }[]).map((m) => ({ ...m, versiones: [{ clase: 'imagen', lado: 960, formato: 'webp', ruta: `t/${m.id}-960.webp`, bytes: 9 }, { clase: 'imagen', lado: 480, formato: 'webp', ruta: `t/${m.id}-480.webp`, bytes: 5 }] })) : r))) as never);
};

describe('miniaturas de la ficha', () => {
  const preparar = async (e: Entorno, adjunta: boolean): Promise<string> => {
    const r = await e.api.llamar('reservarSubida', { subidaId: '22222222-2222-4222-8222-222222222222', productoId: 'tv-55', tipo: 'foto', bytes: 10 });
    await e.api.llamar('finalizarSubida', { subidaId: r.subidaId });
    if (adjunta) {
      const ficha = { slug: 'tv-55', descripcion: 'Televisor.', garantia: '12 meses', medios: [{ medioId: r.subidaId, alt: 'Frente del televisor' }], seo: { titulo: 'Televisor', descripcion: '' }, estado: 'borrador' };
      await e.api.llamar('guardarFicha', { productoId: 'tv-55', ficha: ficha as never });
    }
    return r.subidaId;
  };

  it('muestra la miniatura de la foto de la ficha con su texto alternativo real', async () => {
    vi.stubEnv('VITE_MEDIOS_BASE_URL', BASE_MEDIOS);
    const e = crearEntorno('sup');
    const id = await preparar(e, true);
    conVersiones(e);
    ver(e);
    const u = userEvent.setup();
    const dialogo = await abrir(u, 'Editar página', TV);
    const img = (await within(dialogo).findByAltText('Frente del televisor')) as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(`${BASE_MEDIOS}/t/${id}-480.webp`);
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('sin base muestra el respaldo con el número de orden y las medidas', async () => {
    vi.stubEnv('VITE_MEDIOS_BASE_URL', '');
    const e = crearEntorno('sup');
    await preparar(e, true);
    conVersiones(e);
    ver(e);
    const u = userEvent.setup();
    const dialogo = await abrir(u, 'Editar página', TV);
    await within(dialogo).findByText('Foto 1 (portada)');
    expect(dialogo.querySelector('img')).toBeNull();
    expect(dialogo.querySelector('[data-respaldo]')?.textContent).toBe('Foto · n.º 1 · 1200 × 800');
  });

  it('también muestra miniatura en los archivos subidos que no están en la página', async () => {
    vi.stubEnv('VITE_MEDIOS_BASE_URL', BASE_MEDIOS);
    const e = crearEntorno('sup');
    const id = await preparar(e, false);
    conVersiones(e);
    ver(e);
    const u = userEvent.setup();
    const dialogo = await abrir(u, 'Editar página', TV);
    await within(dialogo).findByText('Archivos subidos que no están en la página:');
    expect(dialogo.querySelector('img')?.getAttribute('src')).toBe(`${BASE_MEDIOS}/t/${id}-480.webp`);
  });
});
