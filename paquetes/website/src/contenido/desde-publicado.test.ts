import { describe, expect, it } from 'vitest';
import { ErrorContenidoPublicado, contenidoDesdePublicado, iconoDeCategoria, nombreDeCategoria, type EntornoSitio } from './desde-publicado.js';
import { contenidoEjemplo } from './ejemplo.js';
import { validarNegocio } from './validar.js';

// Todo inventado: dominios .invalid, nombres de ejemplo.
const MEDIOS = 'https://medios.ejemplo.invalid';
const entorno: EntornoSitio = {
  origen: 'https://tienda.ejemplo.invalid', origenMedios: MEDIOS, appCheck: null, recaptchaSiteKey: null,
  disponibilidad: { 'p-uno': true },
};

const medioFoto = (ruta: string, lados: number[] = [480, 960, 1600]) => ({
  tipo: 'foto', alt: 'Foto de ejemplo', ancho: 2000, alto: 1000,
  versiones: [
    ...lados.map((lado) => ({ clase: 'imagen', lado, formato: 'webp', ruta: `${ruta}/${lado}.webp` })),
    { clase: 'imagen', lado: 960, formato: 'jpeg', ruta: `${ruta}/960.jpg` },
  ],
});
const medioVideo = (ruta: string) => ({
  tipo: 'video', alt: 'Video de ejemplo', ancho: 1280, alto: 720,
  versiones: [
    { clase: 'video', lado: 720, formato: 'mp4', ruta: `${ruta}/v720.mp4` },
    { clase: 'video', lado: 1080, formato: 'mp4', ruta: `${ruta}/v1080.mp4` },
    { clase: 'poster', lado: 640, formato: 'webp', ruta: `${ruta}/p640.webp` },
  ],
});
const prod = (id: string, extra: Record<string, unknown> = {}) => ({
  id, slug: id, nombre: `Producto ${id}`, categoria: 'aire-acondicionado', marca: 'Marca Ejemplo',
  descripcion: 'Descripción de ejemplo.', garantia: '12 meses', medios: [medioFoto(`m/${id}`)],
  seo: {}, precioUSD: { bo: 100, ar: 120 }, ...extra,
});
const negocioBase = () => {
  const c = contenidoEjemplo;
  return {
    nombre: 'Tienda de Ejemplo', lema: 'Lema de ejemplo', logo: null, whatsappTienda: null, telefono: null, correo: null,
    direccion: 'Calle Ficticia 123', horario: null, mercados: ['BO', 'AR'], mercadoInicial: 'BO', enlacesPermitidos: ['ejemplo.invalid'],
    portada: c.portada, beneficios: c.beneficios, identidad: { ...c.identidad, foto: null }, textoPrivacidad: ['Texto de privacidad de ejemplo.'],
    categorias: {}, destacados: [],
  };
};
const redondeo = { BOB: { tipo: 'decimales', decimales: 2, modo: 'cercano' }, ARS: { tipo: 'multiplo', multiplo: 500, modo: 'arriba' } };
const respuesta = (extra: Record<string, unknown> = {}, estado: Record<string, unknown> = {}) => ({
  redondeo,
  documentos: {
    sitio: { plantillaActiva: 'bosque', whatsappNovuchat: '59170000000', medicion: {}, version: 3 },
    estado: { version: 3, secciones: [], ...estado },
    producto__uno: prod('p-uno'),
    producto__dos: prod('p-dos', { categoria: 'parlantes-audio', garantia: '', medios: [medioFoto('m/p-dos'), medioVideo('m/p-dos')] }),
    ...extra,
  },
});

describe('contenidoDesdePublicado', () => {
  it('mapea productos, precios, disponibilidad y garantía vacía', () => {
    const c = contenidoDesdePublicado(respuesta(), negocioBase(), entorno);
    expect(c.productos.map((p) => p.id)).toEqual(['p-dos', 'p-uno']);
    expect(c.productos[1]!.precioUsd).toEqual({ BO: 100, AR: 120 });
    expect(c.productos[1]!.disponible).toBe(true);
    expect(c.productos[0]!.disponible).toBe(false);
    expect(c.productos[0]!.garantia).toBeNull();
    expect(c.config.esEjemplo).toBe(false);
    expect(c.config.plantilla).toBe('bosque');
    expect(c.config.whatsappNovuchat).toBe('59170000000');
  });

  it('elige la versión webp más cercana a 960 px y lista todas las webp; video con poster', () => {
    const c = contenidoDesdePublicado(respuesta(), negocioBase(), entorno);
    const f = c.productos[1]!.fotos[0]!;
    expect(f.url).toBe(`${MEDIOS}/m/p-uno/960.webp`);
    expect(f.versiones).toEqual([
      { url: `${MEDIOS}/m/p-uno/480.webp`, ancho: 480 },
      { url: `${MEDIOS}/m/p-uno/960.webp`, ancho: 960 },
      { url: `${MEDIOS}/m/p-uno/1600.webp`, ancho: 1600 },
    ]);
    expect(c.productos[0]!.fotos).toHaveLength(1);
    expect(c.productos[0]!.video).toEqual({ url: `${MEDIOS}/m/p-dos/v1080.mp4`, poster: `${MEDIOS}/m/p-dos/p640.webp`, titulo: 'Video de ejemplo' });
  });

  it('copia el redondeo de la respuesta y la medición con los nombres del sitio', () => {
    const r = respuesta();
    r.documentos.sitio.medicion = { ga4: 'G-ABCD1234', metaPixel: '12345678' } as never;
    const c = contenidoDesdePublicado(r, negocioBase(), entorno);
    expect(c.config.redondeo).toEqual(redondeo);
    expect(c.config.medicion).toMatchObject({ google: 'G-ABCD1234', meta: '12345678', searchConsole: null, tiktok: null });
  });

  it('deriva categorías por tabla de palabras clave y respeta la sobrescritura del negocio', () => {
    const c = contenidoDesdePublicado(respuesta(), { ...negocioBase(), categorias: { 'parlantes-audio': { nombre: 'Sonido', icono: 'cuadricula' } } }, entorno);
    expect(c.categorias).toEqual([
      { id: 'aire-acondicionado', nombre: 'Aire acondicionado', icono: 'aire' },
      { id: 'parlantes-audio', nombre: 'Sonido', icono: 'cuadricula' },
    ]);
    expect(iconoDeCategoria('cosas-varias')).toBe('cuadricula');
    expect(iconoDeCategoria('televisores')).toBe('televisor');
    expect(nombreDeCategoria('lavadoras')).toBe('Lavadoras');
    expect(c.marcas).toEqual(['Marca Ejemplo']);
  });

  it('destacados salen de la lista del negocio (vacía = ninguno)', () => {
    const sin = contenidoDesdePublicado(respuesta(), negocioBase(), entorno);
    expect(sin.productos.some((p) => p.destacado)).toBe(false);
    const con = contenidoDesdePublicado(respuesta(), { ...negocioBase(), destacados: ['p-dos'] }, entorno);
    expect(con.productos.map((p) => p.destacado)).toEqual([true, false]);
  });

  it('D5: sin carrusel cargado usa las primeras fotos de los destacados, o de los productos', () => {
    const porProductos = contenidoDesdePublicado(respuesta(), negocioBase(), entorno);
    expect(porProductos.carruseles.cielo.map((f) => f.url)).toEqual([`${MEDIOS}/m/p-dos/960.webp`, `${MEDIOS}/m/p-uno/960.webp`]);
    const porDestacados = contenidoDesdePublicado(respuesta(), { ...negocioBase(), destacados: ['p-dos'] }, entorno);
    expect(porDestacados.carruseles.ciruela.map((f) => f.url)).toEqual([`${MEDIOS}/m/p-dos/960.webp`]);
  });

  it('D5: topa en 8 fotos y un carrusel cargado manda sobre el respaldo', () => {
    const muchos = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`producto__x${i}`, prod(`p-x${i}`)]));
    const c = contenidoDesdePublicado(respuesta({ ...muchos, carrusel__ambar: { plantilla: 'ambar', items: [medioFoto('m/car')] } }), negocioBase(), entorno);
    expect(c.carruseles.cielo).toHaveLength(8);
    expect(c.carruseles.ambar.map((f) => f.url)).toEqual([`${MEDIOS}/m/car/960.webp`]);
  });

  it('secciones en el orden del estado, con bloques de texto, imagen y enlaces', () => {
    const r = respuesta({
      seccion__b: { id: 'b', titulo: 'Segunda', bloques: [{ tipo: 'texto', titulo: 'T', parrafos: ['uno'] }] },
      seccion__a: { id: 'a', titulo: 'Primera', bloques: [{ tipo: 'imagen', medio: medioFoto('m/s') }, { tipo: 'enlaces', items: [{ texto: 'Ir', url: 'https://ejemplo.invalid/x' }] }] },
    }, { secciones: ['a', 'b'] });
    const c = contenidoDesdePublicado(r, negocioBase(), entorno);
    expect(c.secciones.map((s) => [s.slug, s.orden])).toEqual([['a', 0], ['b', 1]]);
    expect(c.secciones[0]!.bloques[0]).toMatchObject({ tipo: 'imagen', foto: { url: `${MEDIOS}/m/s/960.webp` } });
  });

  it('marca ausente: error que nombra el campo y no incluye valores', () => {
    const r = respuesta();
    delete (r.documentos.producto__uno as Record<string, unknown>)['marca'];
    let error: unknown;
    try { contenidoDesdePublicado(r, negocioBase(), entorno); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(ErrorContenidoPublicado);
    const mensaje = (error as Error).message;
    expect(mensaje).toContain('documentos.producto__uno.marca');
    expect(mensaje).not.toContain('Producto p-uno');
    expect(mensaje).not.toContain('Descripción de ejemplo');
  });

  it('negocio inválido: lista campos sin valores', () => {
    const malo = { ...negocioBase(), nombre: 'Nombre Secreto', whatsappTienda: 'no-es-numero', mercados: [] };
    let mensaje = '';
    try { contenidoDesdePublicado(respuesta(), malo, entorno); } catch (e) { mensaje = (e as Error).message; }
    expect(mensaje).toContain('negocio.whatsappTienda');
    expect(mensaje).toContain('negocio.mercados');
    expect(mensaje).not.toContain('no-es-numero');
  });

  it('respuesta sin documentos o sin sitio falla con campos', () => {
    expect(() => contenidoDesdePublicado({}, negocioBase(), entorno)).toThrow(/respuesta\.documentos/);
    const r = respuesta();
    delete (r.documentos as Record<string, unknown>)['sitio'];
    expect(() => contenidoDesdePublicado(r, negocioBase(), entorno)).toThrow(/documentos\.sitio/);
  });
});

describe('validarNegocio', () => {
  it('acepta logo e identidad.foto nulos y categorías vacías', () => {
    expect(validarNegocio(negocioBase()).ok).toBe(true);
    const sinOpcionales: Record<string, unknown> = { ...negocioBase() };
    delete sinOpcionales['categorias'];
    delete sinOpcionales['destacados'];
    expect(validarNegocio(sinOpcionales).ok).toBe(true);
  });
  it('rechaza ícono fuera de la lista en categorias', () => {
    const r = validarNegocio({ ...negocioBase(), categorias: { 'cat-uno': { nombre: 'X', icono: 'inventado' } } });
    expect(r.ok).toBe(false);
  });
});
