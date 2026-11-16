// @vitest-environment jsdom
import { h } from 'preact';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorApi } from '../../api/errores.js';
import { crearEntorno, uuid, type Entorno } from '../../ayuda-pruebas.js';
import { ProveedorGuardia } from '../../ui/guardia.js';
import { PantallaCatalogo } from './catalogo.js';
import { BloqueLogo } from './logo-vista.js';
import { PALETAS } from './plantillas-vista.js';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('catálogo: exportar', () => {
  it('exporta el CSV, avisa el éxito y enlaza a la importación de Inventario', async () => {
    const e = crearEntorno('adm');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }));
    render(e.envolver(h(PantallaCatalogo, { sub: 'exportar' })));
    const u = userEvent.setup();
    expect(screen.getByText(/Los productos se crean e importan en Inventario/)).toBeTruthy();
    expect(screen.getByText(/precios en dólares, con decimales, y puede reimportarse en Inventario/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ir a la importación de Inventario' }).getAttribute('href')).toBe('#/inventario/csv');
    await u.click(screen.getByRole('button', { name: 'Exportar productos (CSV)' }));
    expect(await screen.findByText(/productos-sitio\.csv generado/)).toBeTruthy();
    await waitFor(() => expect(e.api.llamadas.some((l) => l.nombre === 'exportarProductosCsvSitio')).toBe(true));
  });
  it('no tiene controles de importación', async () => {
    const e = crearEntorno('adm');
    render(e.envolver(h(PantallaCatalogo, { sub: 'exportar' })));
    expect(screen.queryByLabelText('Archivo a importar')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Importar' })).toBeNull();
    expect(screen.queryByText(/Simulación/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Exportar' })).toBeTruthy();
  });
});

describe('catálogo: mercados declarados', () => {
  it('el tenant de referencia ve los nombres de sus mercados', async () => {
    const e = crearEntorno('adm');
    render(e.envolver(h(PantallaCatalogo, { sub: 'tablero' })));
    expect(await screen.findByText(/Bolivia:/)).toBeTruthy();
    expect(screen.getByText(/Argentina:/)).toBeTruthy();
  });
  it('un id de mercado no declarado se muestra tal cual', async () => {
    const e = crearEntorno('adm', undefined, { comercial: { mercados: [{ id: 'BO', nombre: 'Bolivia', monedaVenta: 'BOB', monedaBase: 'USD', tieneTipoCambio: true }], monedasCaja: ['BOB'] } });
    render(e.envolver(h(PantallaCatalogo, { sub: 'tablero' })));
    expect(await screen.findByText(/Bolivia:/)).toBeTruthy();
    expect(screen.getByText(/AR:/)).toBeTruthy();
  });
  it('mientras la configuración comercial carga, no muestra mercados', async () => {
    const e = crearEntorno('adm');
    vi.spyOn(e.api, 'llamar').mockImplementation((() => new Promise(() => undefined)) as never);
    render(e.envolver(h(PantallaCatalogo, { sub: 'tablero' })));
    expect(screen.queryByText(/Bolivia:|BO:/)).toBeNull();
    expect(document.body.textContent ?? '').toMatch(/Cargando/);
  });
  it('si la configuración comercial falla, muestra el error y no ids crudos', async () => {
    const e = crearEntorno('adm');
    const llamar = e.api.llamar.bind(e.api) as (n: string, x: unknown) => Promise<unknown>;
    vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, x: unknown) => (n === 'configuracionComercial' ? Promise.reject(new Error('falla comercial')) : llamar(n, x))) as never);
    render(e.envolver(h(PantallaCatalogo, { sub: 'tablero' })));
    await waitFor(() => expect(document.querySelector('[role="alert"], .alerta')).not.toBeNull());
    expect(screen.queryByText(/BO:|AR:/)).toBeNull();
  });
});

describe('catálogo: tablero', () => {
  it('la fecha de publicación se llama «Última publicación del sitio»', async () => {
    const e = crearEntorno('adm');
    render(e.envolver(h(PantallaCatalogo, { sub: 'tablero' })));
    expect(await screen.findByText('Última publicación del sitio')).toBeTruthy();
    expect(screen.getByText('Todavía no se publicó')).toBeTruthy();
    expect(screen.queryByText('Publicado')).toBeNull();
  });
});

describe('catálogo: apariencia', () => {
  const ver = (e: Entorno): void => void render(e.envolver(h(ProveedorGuardia, null, h(PantallaCatalogo, { sub: 'apariencia' }))));
  const subirFoto = async (e: Entorno): Promise<void> => {
    const r = await e.api.llamar('reservarSubida', { subidaId: uuid(), productoId: 'tv-55', tipo: 'foto', bytes: 10 });
    await e.api.llamar('finalizarSubida', { subidaId: r.subidaId });
  };
  const agregarFoto = async (u: ReturnType<typeof userEvent.setup>): Promise<void> => {
    await u.type(await screen.findByRole('combobox', { name: 'Producto de la foto' }), 'Televisor');
    await u.click(await screen.findByRole('option', { name: /Televisor/ }));
    await u.click(await screen.findByRole('button', { name: /^Agregar foto/ }));
  };
  const whatsapp = (): HTMLElement => screen.getByLabelText(/WhatsApp del asistente/);

  it('mientras falta el WhatsApp, «Guardar apariencia» dice por qué y no guarda; el error va junto al campo', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    const guardar = await screen.findByRole('button', { name: 'Guardar apariencia' });
    expect(guardar.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('No hay cambios por guardar.')).toBeTruthy();
    await u.clear(whatsapp());
    expect(screen.getByText(/Escriba el WhatsApp del asistente/)).toBeTruthy();
    await u.click(guardar);
    expect(e.api.llamadas.some((l) => l.nombre === 'guardarConfigSitio')).toBe(false);
    await u.type(whatsapp(), '123');
    expect(whatsapp().getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(/Use solo dígitos, con código de país/)).toBeTruthy();
  });

  it('sin WhatsApp en el servidor, un cambio solo en el carrusel se guarda', async () => {
    const e = crearEntorno('adm');
    await e.api.llamar('guardarConfigSitio', { config: { plantillaActiva: 'cielo', whatsappNovuchat: '59171112222', medicion: {} } });
    await subirFoto(e);
    const llamar = e.api.llamar.bind(e.api) as (n: string, x: unknown) => Promise<unknown>;
    vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, x: unknown) => (n === 'leerConfigSitio' ? Promise.resolve({ plantillaActiva: 'cielo', whatsappNovuchat: '', medicion: {} }) : llamar(n, x))) as never);
    ver(e);
    const u = userEvent.setup();
    await agregarFoto(u);
    await u.click(await screen.findByRole('button', { name: 'Guardar apariencia' }));
    expect(await screen.findByText(/Apariencia guardada/)).toBeTruthy();
    expect(e.api.llamadas.filter((l) => l.nombre === 'guardarConfigSitio')).toHaveLength(1);
    expect(e.api.llamadas.filter((l) => l.nombre === 'guardarCarrusel')).toHaveLength(1);
  });

  it('lo guardado sale del borrador al llegar los datos nuevos: el campo no vuelve al valor viejo', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    await screen.findByRole('button', { name: 'Guardar apariencia' });
    await u.clear(whatsapp());
    await u.type(whatsapp(), '59171112222');
    await u.click(screen.getByRole('button', { name: 'Guardar apariencia' }));
    expect(await screen.findByText(/Apariencia guardada/)).toBeTruthy();
    expect((whatsapp() as HTMLInputElement).value).toBe('59171112222');
    await waitFor(() => expect(e.api.llamadas.filter((l) => l.nombre === 'leerConfigSitio').length).toBeGreaterThan(1));
    expect(screen.getByText('No hay cambios por guardar.')).toBeTruthy();
  });

  it('cambiar de plantilla no borra lo editado en el carrusel de la otra', async () => {
    const e = crearEntorno('adm');
    await subirFoto(e);
    ver(e);
    const u = userEvent.setup();
    await agregarFoto(u);
    const alt = await screen.findByLabelText('Texto alternativo de la foto 1');
    await u.clear(alt);
    await u.type(alt, 'Frente del televisor');
    await u.click(screen.getByRole('radio', { name: /Ciruela/ }));
    expect(screen.getByRole('heading', { name: /Carrusel de portada \(Ciruela\)/ })).toBeTruthy();
    expect(screen.queryByLabelText('Texto alternativo de la foto 1')).toBeNull();
    await u.click(screen.getByRole('radio', { name: new RegExp(PALETAS.cielo.nombre) }));
    expect((await screen.findByLabelText('Texto alternativo de la foto 1') as HTMLInputElement).value).toBe('Frente del televisor');
  });

  it('un solo «Guardar apariencia» guarda la plantilla y el carrusel editado', async () => {
    const e = crearEntorno('adm');
    await subirFoto(e);
    ver(e);
    const u = userEvent.setup();
    await agregarFoto(u);
    await u.clear(whatsapp());
    await u.type(whatsapp(), '59171112222');
    expect(screen.getAllByRole('button', { name: /^Guardar/ })).toHaveLength(1);
    await u.click(screen.getByRole('button', { name: 'Guardar apariencia' }));
    expect(await screen.findByText(/Apariencia guardada/)).toBeTruthy();
    expect(e.api.llamadas.filter((l) => l.nombre === 'guardarConfigSitio')).toHaveLength(1);
    expect(e.api.llamadas.filter((l) => l.nombre === 'guardarCarrusel')).toHaveLength(1);
    expect((await e.api.llamar('listarCarruseles', {}))[0]?.items).toHaveLength(1);
  });

  it('si el carrusel falla, el aviso dice qué quedó guardado y qué no, y conserva lo escrito', async () => {
    const e = crearEntorno('adm');
    await subirFoto(e);
    ver(e);
    const u = userEvent.setup();
    await agregarFoto(u);
    await u.clear(whatsapp());
    await u.type(whatsapp(), '59171112222');
    const llamar = e.api.llamar.bind(e.api) as (n: string, x: unknown) => Promise<unknown>;
    vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, x: unknown) => (n === 'guardarCarrusel' ? Promise.reject(new ErrorApi('unavailable', 'sin conexión')) : llamar(n, x))) as never);
    await u.click(screen.getByRole('button', { name: 'Guardar apariencia' }));
    const aviso = await screen.findByText(/Quedó guardado: la plantilla y los datos del sitio\. No quedó guardado: el carrusel de/);
    expect(aviso.textContent).not.toMatch(/Apariencia guardada/);
    expect((await e.api.llamar('leerConfigSitio', {}))?.whatsappNovuchat).toBe('59171112222');
    expect(await e.api.llamar('listarCarruseles', {})).toHaveLength(0);
    expect(screen.getByLabelText('Texto alternativo de la foto 1')).toBeTruthy();
  });

  it('con cambios sin guardar, cerrar la pestaña pregunta; sin cambios, no', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    await screen.findByRole('button', { name: 'Guardar apariencia' });
    const cierre = (): boolean => !window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
    expect(cierre()).toBe(false);
    await u.type(whatsapp(), '5917');
    await waitFor(() => expect(cierre()).toBe(true));
  });
});

const BASE_MEDIOS = 'https://medios.ejemplo.test';
/** Hace que `listarMedios` entregue versiones WebP, como el servidor tras procesar la foto. */
const conVersiones = (e: Entorno): void => {
  const original = e.api.llamar.bind(e.api) as (n: string, d: unknown) => Promise<unknown>;
  vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, d: unknown) =>
    original(n, d).then((r) => (n === 'listarMedios' ? (r as { id: string }[]).map((m) => ({ ...m, versiones: [{ clase: 'imagen', lado: 960, formato: 'webp', ruta: `t/${m.id}-960.webp`, bytes: 9 }, { clase: 'imagen', lado: 480, formato: 'webp', ruta: `t/${m.id}-480.webp`, bytes: 5 }] })) : r))) as never);
};

describe('catálogo: miniaturas del carrusel', () => {
  const ver = (e: Entorno): void => void render(e.envolver(h(ProveedorGuardia, null, h(PantallaCatalogo, { sub: 'apariencia' }))));
  const preparar = async (e: Entorno): Promise<string> => {
    const r = await e.api.llamar('reservarSubida', { subidaId: uuid(), productoId: 'tv-55', tipo: 'foto', bytes: 10 });
    await e.api.llamar('finalizarSubida', { subidaId: r.subidaId });
    return r.subidaId;
  };
  const elegir = async (u: ReturnType<typeof userEvent.setup>): Promise<void> => {
    await u.type(await screen.findByRole('combobox', { name: 'Producto de la foto' }), 'Televisor');
    await u.click(await screen.findByRole('option', { name: /Televisor/ }));
  };

  it('muestra la miniatura al elegir y al agregar la foto al carrusel', async () => {
    vi.stubEnv('VITE_MEDIOS_BASE_URL', BASE_MEDIOS);
    const e = crearEntorno('adm');
    const id = await preparar(e);
    conVersiones(e);
    ver(e);
    const u = userEvent.setup();
    await elegir(u);
    const boton = await screen.findByRole('button', { name: /^Agregar foto/ });
    expect(boton.querySelector('img')?.getAttribute('src')).toBe(`${BASE_MEDIOS}/t/${id}-480.webp`);
    await u.click(boton);
    const item = (await screen.findByLabelText('Texto alternativo de la foto 1')).closest('li');
    expect(item?.querySelector('img')?.getAttribute('src')).toBe(`${BASE_MEDIOS}/t/${id}-480.webp`);
    expect(item?.querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('sin base muestra el respaldo con el orden y las medidas', async () => {
    vi.stubEnv('VITE_MEDIOS_BASE_URL', '');
    const e = crearEntorno('adm');
    await preparar(e);
    conVersiones(e);
    ver(e);
    const u = userEvent.setup();
    await elegir(u);
    await u.click(await screen.findByRole('button', { name: /^Agregar foto/ }));
    const item = (await screen.findByLabelText('Texto alternativo de la foto 1')).closest('li');
    expect(item?.querySelector('img')).toBeNull();
    expect(item?.querySelector('[data-respaldo]')?.textContent).toMatch(/n\.º 1 · 1200 × 800/);
  });

  it('tras recargar, las fotos ya guardadas del carrusel muestran su miniatura', async () => {
    vi.stubEnv('VITE_MEDIOS_BASE_URL', BASE_MEDIOS);
    const e = crearEntorno('adm');
    const id = await preparar(e);
    await e.api.llamar('guardarFicha', { productoId: 'tv-55', ficha: { slug: 'tv-55', descripcion: 'Televisor.', garantia: '12 meses', medios: [{ medioId: id, alt: 'Frente del televisor' }], seo: { titulo: 'Televisor', descripcion: '' }, estado: 'borrador' } as never });
    const cfg = await e.api.llamar('leerConfigSitio', {});
    await e.api.llamar('guardarCarrusel', { carrusel: { plantilla: (cfg as NonNullable<typeof cfg>).plantillaActiva, items: [{ medioId: id, alt: 'Frente del televisor' }] } });
    conVersiones(e);
    ver(e);
    const item = (await screen.findByLabelText('Texto alternativo de la foto 1')).closest('li');
    await waitFor(() => expect(item?.querySelector('img')?.getAttribute('src')).toBe(`${BASE_MEDIOS}/t/${id}-480.webp`));
  });

  it('con 40 productos, la foto del producto 35 en el carrusel muestra su miniatura con una sola lectura de medios', async () => {
    vi.stubEnv('VITE_MEDIOS_BASE_URL', BASE_MEDIOS);
    const e = crearEntorno('adm');
    const productos = await e.api.llamar('listarProductos', {});
    const base = productos[0] as NonNullable<(typeof productos)[number]>;
    const muchos = Array.from({ length: 40 }, (_, i) => ({ ...base, id: `prod-${String(i + 1).padStart(2, '0')}`, nombre: `Producto ${String(i + 1)}` }));
    const original = e.api.llamar.bind(e.api) as (n: string, d: unknown) => Promise<unknown>;
    const id = await preparar(e);
    const medio = { id, productoId: 'prod-35', tipo: 'foto', bytesOriginal: 10, ancho: 1200, alto: 800, creadoEn: 0, por: 'u', versiones: [{ clase: 'imagen', lado: 480, formato: 'webp', ruta: `t/${id}-480.webp`, bytes: 5 }] };
    const ficha = { slug: 'p35', descripcion: '', garantia: '', medios: [{ medioId: id, alt: 'x' }], seo: { titulo: 'p', descripcion: '' }, estado: 'borrador' };
    const cfg = await e.api.llamar('leerConfigSitio', {});
    await e.api.llamar('guardarCarrusel', { carrusel: { plantilla: (cfg as NonNullable<typeof cfg>).plantillaActiva, items: [{ medioId: id, alt: 'Foto 35' }] } });
    const lecturas: string[] = [];
    vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, d: unknown) => {
      if (n === 'listarProductos') return Promise.resolve(muchos);
      if (n === 'listarFichas') return Promise.resolve([{ productoId: 'prod-35', ficha }]);
      if (n === 'listarMedios') { lecturas.push((d as { productoId: string }).productoId); return Promise.resolve((d as { productoId: string }).productoId === 'prod-35' ? [medio] : []); }
      return original(n, d);
    }) as never);
    ver(e);
    const item = (await screen.findByLabelText('Texto alternativo de la foto 1')).closest('li');
    await waitFor(() => expect(item?.querySelector('img')?.getAttribute('src')).toBe(`${BASE_MEDIOS}/t/${id}-480.webp`));
    expect(lecturas).toEqual(['prod-35']);
  });

  it('un fallo que no es de sesión deja el respaldo sin romper la pantalla', async () => {
    vi.stubEnv('VITE_MEDIOS_BASE_URL', BASE_MEDIOS);
    const e = crearEntorno('adm');
    const id = await preparar(e);
    const cfg = await e.api.llamar('leerConfigSitio', {});
    await e.api.llamar('guardarCarrusel', { carrusel: { plantilla: (cfg as NonNullable<typeof cfg>).plantillaActiva, items: [{ medioId: id, alt: 'Frente' }] } });
    const original = e.api.llamar.bind(e.api) as (n: string, d: unknown) => Promise<unknown>;
    vi.spyOn(e.api, 'llamar').mockImplementation(((n: string, d: unknown) => (n === 'listarFichas' ? Promise.reject(new ErrorApi('internal', 'falla')) : original(n, d))) as never);
    ver(e);
    const item = (await screen.findByLabelText('Texto alternativo de la foto 1')).closest('li');
    expect(item?.querySelector('[data-respaldo]')).toBeTruthy();
  });
});

describe('catálogo: logo del negocio', () => {
  const ver = (e: Entorno): void => void render(e.envolver(h(ProveedorGuardia, null, h(PantallaCatalogo, { sub: 'apariencia' }))));
  const archivo = (nombre: string, tipo: string, bytes = 10): File => new File([new Uint8Array(bytes)], nombre, { type: tipo });
  const subir = async (nombre = 'logo.png', tipo = 'image/png'): Promise<void> => {
    fireEvent.change(await screen.findByLabelText('Archivo del logo'), { target: { files: [archivo(nombre, tipo)] } });
  };

  it('sin logo: «Subir logo»; subir uno lo muestra y deja «Reemplazar logo» sin tocar «Guardar apariencia»', async () => {
    vi.stubEnv('VITE_MEDIOS_BASE_URL', BASE_MEDIOS);
    const e = crearEntorno('adm');
    ver(e);
    expect(await screen.findByRole('button', { name: 'Subir logo' })).toBeTruthy();
    expect(screen.getByText(/El logo se guarda al subirlo/)).toBeTruthy();
    await subir();
    expect(await screen.findByText(/Logo guardado/)).toBeTruthy();
    const img = (await screen.findByAltText('Logo del negocio')) as HTMLImageElement;
    expect(img.getAttribute('src')).toMatch(new RegExp(`^${BASE_MEDIOS}/_negocio/logo-.*\\.webp$`));
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(screen.getByRole('button', { name: 'Reemplazar logo' })).toBeTruthy();
    expect(e.api.llamadas.some((l) => l.nombre === 'guardarConfigSitio')).toBe(false);
  });
  it('reemplazar deja un solo logo vigente', async () => {
    vi.stubEnv('VITE_MEDIOS_BASE_URL', BASE_MEDIOS);
    const e = crearEntorno('adm');
    ver(e);
    await subir('uno.png', 'image/png');
    await screen.findByAltText('Logo del negocio');
    const primero = e.api.estado.logo?.medio.id;
    await subir('dos.webp', 'image/webp');
    await waitFor(() => expect(e.api.estado.logo?.medio.id).not.toBe(primero));
    expect(e.api.estado.logo).not.toBeNull();
    await waitFor(() => expect((screen.getByAltText('Logo del negocio') as HTMLImageElement).getAttribute('src')).toContain(e.api.estado.logo?.medio.id ?? 'x'));
  });
  it('un archivo demasiado grande se rechaza antes de subir, con su motivo', async () => {
    const e = crearEntorno('adm');
    ver(e);
    await screen.findByLabelText('Archivo del logo');
    const grande = archivo('enorme.png', 'image/png');
    Object.defineProperty(grande, 'size', { value: 3 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText('Archivo del logo'), { target: { files: [grande] } });
    expect(await screen.findByText(/enorme\.png: El logo «enorme\.png» pesa .* y el máximo es/)).toBeTruthy();
    expect(e.api.llamadas.some((l) => l.nombre === 'reservarSubidaLogo')).toBe(false);
  });
  it('un SVG o un tipo no admitido se rechaza antes de subir', async () => {
    const e = crearEntorno('adm');
    ver(e);
    await subir('marca.svg', 'image/svg+xml');
    expect(await screen.findByText(/es un SVG y no se admite/)).toBeTruthy();
    await subir('doc.pdf', 'application/pdf');
    expect(await screen.findByText(/no es un formato permitido para el logo/)).toBeTruthy();
    expect(e.api.llamadas.some((l) => l.nombre === 'reservarSubidaLogo')).toBe(false);
  });
  it('si el servidor rechaza el archivo, muestra su motivo y no ofrece «Reintentar»', async () => {
    const e = crearEntorno('adm');
    e.api.estado.disparador.rechazo = 'El archivo no es una imagen válida';
    ver(e);
    await subir('roto.png');
    expect(await screen.findByText(/roto\.png: El archivo no es una imagen válida/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Elegir otro archivo' })).toBeTruthy();
    expect(e.api.estado.logo).toBeNull();
  });
  it('quitar pide confirmación y deja sin logo', async () => {
    const e = crearEntorno('adm');
    ver(e);
    const u = userEvent.setup();
    await subir();
    await screen.findByRole('button', { name: 'Reemplazar logo' });
    await u.click(screen.getByRole('button', { name: 'Quitar logo' }));
    expect(e.api.estado.logo).not.toBeNull();
    await u.click(screen.getByRole('button', { name: 'Sí, quitar' }));
    expect(await screen.findByText(/Logo quitado/)).toBeTruthy();
    expect(e.api.estado.logo).toBeNull();
    expect(await screen.findByRole('button', { name: 'Subir logo' })).toBeTruthy();
  });
  it('sin base de medios muestra el respaldo de texto', async () => {
    vi.stubEnv('VITE_MEDIOS_BASE_URL', '');
    const e = crearEntorno('adm');
    ver(e);
    await subir();
    expect(await screen.findByText(/la vista previa no está disponible/)).toBeTruthy();
    expect(screen.queryByAltText('Logo del negocio')).toBeNull();
  });
  it('el supervisor solo ve el logo: sin botones y con el aviso', async () => {
    // La pestaña Apariencia es del administrador; el bloque se prueba solo para el caso de verse con otro rol.
    const e = crearEntorno('sup');
    render(e.envolver(h(BloqueLogo, {})));
    expect(await screen.findByText('Solo el administrador cambia el logo.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /logo/i })).toBeNull();
    expect(screen.queryByLabelText('Archivo del logo')).toBeNull();
  });
});
