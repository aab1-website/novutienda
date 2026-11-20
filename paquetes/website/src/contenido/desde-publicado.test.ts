import { MAX_CATEGORIAS_SITIO } from '@novutienda/nucleo';
import { describe, expect, it } from 'vitest';
import { ErrorContenidoPublicado, contenidoDesdePublicado, contenidoYFuenteDesdePublicado, iconoDeCategoria, nombreDeCategoria, type EntornoSitio } from './desde-publicado.js';
import { contenidoEjemplo } from './ejemplo.js';
import { huellaContenido, huellaSinDisponibilidad } from '../lib/huella.js';
import { urlMedioSegura, validarNegocio } from './validar.js';

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
    expect(mensaje).not.toContain('Nombre Secreto');
  });

  it('respuesta sin documentos o sin sitio falla con campos', () => {
    expect(() => contenidoDesdePublicado({}, negocioBase(), entorno)).toThrow(/respuesta\.documentos/);
    const r = respuesta();
    delete (r.documentos as Record<string, unknown>)['sitio'];
    expect(() => contenidoDesdePublicado(r, negocioBase(), entorno)).toThrow(/documentos\.sitio/);
  });
});

describe('base de medios con ruta', () => {
  const conBase: EntornoSitio = { ...entorno, origenMedios: 'https://medios.ejemplo.test', baseMedios: 'https://medios.ejemplo.test/bucket-stg/' };
  it('arma las url con la base y deja el origen en la configuración', () => {
    const c = contenidoDesdePublicado(respuesta(), negocioBase(), conBase);
    expect(c.config.origenMedios).toBe('https://medios.ejemplo.test');
    const urls = c.productos.flatMap((p) => p.fotos.map((f) => f.url));
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u.startsWith('https://medios.ejemplo.test/bucket-stg/')).toBe(true);
  });
  it('rechaza una url fuera del origen', () => {
    const malo = { ...negocioBase(), logo: { url: 'https://otro.ejemplo.test/bucket-stg/x.webp', alt: 'x', versiones: [] } };
    expect(() => contenidoDesdePublicado(respuesta(), malo, conBase)).toThrow(ErrorContenidoPublicado);
  });
  it('acepta una url con ruta bajo el origen', () => {
    expect(urlMedioSegura('https://medios.ejemplo.test/bucket-stg/a.webp', ['https://medios.ejemplo.test'])).toBe(true);
    expect(urlMedioSegura('https://otro.ejemplo.test/bucket-stg/a.webp', ['https://medios.ejemplo.test'])).toBe(false);
  });
});

describe('casos límite', () => {
  const falla = (r: unknown, n: unknown = negocioBase()): string => {
    try { contenidoDesdePublicado(r, n, entorno); } catch (e) { return (e as Error).message; }
    return '';
  };
  it('rechaza rutas de medios con espacios, comas o ..: la foto se omite', () => {
    const mala = { tipo: 'foto', alt: 'x', versiones: [{ clase: 'imagen', lado: 960, formato: 'webp', ruta: 'm/a b,c.webp' }, { clase: 'imagen', lado: 480, formato: 'webp', ruta: '../fuera.webp' }] };
    const r = respuesta({ producto__tres: prod('p-tres', { medios: [mala, medioFoto('m/ok')] }) });
    const c = contenidoDesdePublicado(r, negocioBase(), entorno);
    expect(c.productos.find((p) => p.id === 'p-tres')!.fotos).toHaveLength(1);
  });
  it('un destacado inexistente se ignora', () => {
    const c = contenidoDesdePublicado(respuesta(), { ...negocioBase(), destacados: ['no-existe'] }, entorno);
    expect(c.productos.some((p) => p.destacado)).toBe(false);
  });
  it('claves inválidas se nombran por posición, sin copiarlas al error', () => {
    const r = respuesta({ 'producto__CLAVE SECRETA': { id: 'x' } });
    const m = falla(r);
    expect(m).toContain('documentos.producto__[');
    expect(m).not.toContain('CLAVE SECRETA');
    const m2 = falla(respuesta({}, { secciones: ['Sección Rara'] }));
    expect(m2).toContain('documentos.estado.secciones[0]');
    expect(m2).not.toContain('Sección Rara');
    const m3 = falla(respuesta(), { ...negocioBase(), categorias: { 'Clave Mala': { nombre: 'x', icono: 'check' } } });
    expect(m3).toContain('negocio.categorias[0]');
    expect(m3).not.toContain('Clave Mala');
  });
  it('sin productos publicados: el contenido es válido, con catálogo, categorías y marcas vacíos y carruseles sin fotos', () => {
    const vacia = { redondeo, documentos: { sitio: { plantillaActiva: 'cielo', whatsappNovuchat: null, medicion: {} }, estado: { secciones: [] } } };
    const c = contenidoDesdePublicado(vacia, negocioBase(), entorno);
    expect(c.productos).toEqual([]);
    expect(c.categorias).toEqual([]);
    expect(c.marcas).toEqual([]);
    for (const f of Object.values(c.carruseles)) expect(f).toEqual([]);
  });
  it('productos sin ninguna foto y sin carruseles propios: válido, carruseles vacíos', () => {
    const sinFoto = { producto__uno: prod('p-uno', { medios: [] }), producto__dos: prod('p-dos', { medios: [] }) };
    const c = contenidoDesdePublicado(respuesta(sinFoto), negocioBase(), entorno);
    expect(c.productos).toHaveLength(2);
    for (const f of Object.values(c.carruseles)) expect(f).toEqual([]);
  });
  it('más de 40 categorías: mensaje claro', () => {
    const muchos = Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`producto__c${i}`, prod(`p-c${i}`, { categoria: `cat-${i}` })]));
    expect(falla(respuesta(muchos))).toContain('más de 40 categorías');
  });
});

describe('urlMedioSegura', () => {
  it('rechaza espacios y comas', () => {
    expect(urlMedioSegura('/m/a b.webp', [])).toBe(false);
    expect(urlMedioSegura(`${MEDIOS}/m/a,b.webp`, [MEDIOS])).toBe(false);
    expect(urlMedioSegura(`${MEDIOS}/m/ab.webp`, [MEDIOS])).toBe(true);
  });
});

describe('validarNegocio', () => {
  it('antepone negocio. a los errores de portada, beneficios e identidad', () => {
    const r = validarNegocio({ ...negocioBase(), portada: {}, beneficios: 'x', identidad: {} });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errores.every((e) => e.startsWith('negocio.'))).toBe(true);
  });
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

  it('copia el enlace de la foto del carrusel y lo valida con la lista blanca de enlaces', () => {
    const con = (enlace: string) => respuesta({ carrusel__ambar: { plantilla: 'ambar', items: [{ ...medioFoto('m/car'), enlace }, medioFoto('m/car2')] } });
    const ok = contenidoDesdePublicado(con('https://ejemplo.invalid/oferta'), negocioBase(), entorno);
    expect(ok.carruseles.ambar[0]!.enlace).toBe('https://ejemplo.invalid/oferta');
    expect(ok.carruseles.ambar[1]!.enlace).toBeUndefined();
    expect(contenidoDesdePublicado(con('/productos'), negocioBase(), entorno).carruseles.ambar[0]!.enlace).toBe('/productos');
  });

  it('descarta con advertencia el enlace de carrusel fuera de la lista blanca, inseguro o largo, sin tumbar la reconstrucción', () => {
    const con = (enlace: string) => respuesta({ carrusel__ambar: { plantilla: 'ambar', items: [medioFoto('m/car2'), { ...medioFoto('m/car'), enlace }] } });
    const largo = `https://ejemplo.invalid/${'a'.repeat(600)}`;
    for (const malo of ['https://otro.invalid/secreto-x', 'javascript:alert(1)', largo]) {
      const adv: string[] = [];
      const c = contenidoDesdePublicado(con(malo), negocioBase(), entorno, adv);
      expect(c.carruseles.ambar[1]!.enlace).toBeUndefined();
      expect(adv).toEqual(['documentos.carrusel__ambar.items[1].enlace: enlace descartado (fuera de la lista blanca o demasiado largo)']);
      expect(adv.join('')).not.toContain('secreto-x');
      expect(adv.join('')).not.toContain('javascript');
    }
    expect(() => contenidoDesdePublicado(con('https://otro.invalid/x'), negocioBase(), entorno)).not.toThrow();
    const adv: string[] = [];
    contenidoDesdePublicado(con('https://ejemplo.invalid/oferta'), negocioBase(), entorno, adv);
    expect(adv).toEqual([]);
  });

  describe('enlaces de secciones', () => {
    const ok = { texto: 'Ir', url: 'https://ejemplo.invalid/x' };
    const sec = (bloques: unknown[], extra: Record<string, unknown> = {}) =>
      respuesta({ seccion__a: { id: 'a', titulo: 'A', bloques }, seccion__b: { id: 'b', titulo: 'B', bloques: [{ tipo: 'texto', parrafos: ['hola'] }] }, ...extra }, { secciones: ['a', 'b'] });

    it('conserva los enlaces permitidos y no advierte', () => {
      const adv: string[] = [];
      const c = contenidoDesdePublicado(sec([{ tipo: 'enlaces', titulo: 'T', items: [ok, { texto: 'Tel', url: '/productos' }] }]), negocioBase(), entorno, adv);
      expect(c.secciones[0]!.bloques[0]).toEqual({ tipo: 'enlaces', titulo: 'T', items: [ok, { texto: 'Tel', url: '/productos' }] });
      expect(adv).toEqual([]);
    });

    it('descarta host no permitido, http, javascript: y largos con advertencia por ruta, sin el valor', () => {
      const malos = ['https://otro.invalid/secreto-x', 'http://ejemplo.invalid/secreto-x', 'javascript:secreto-x', `https://ejemplo.invalid/${'a'.repeat(600)}`];
      const adv: string[] = [];
      const items = [ok, ...malos.map((url) => ({ texto: 'Mal', url }))];
      const c = contenidoDesdePublicado(sec([{ tipo: 'enlaces', items }]), negocioBase(), entorno, adv);
      expect(c.secciones[0]!.bloques[0]).toMatchObject({ items: [ok] });
      expect(adv).toEqual([1, 2, 3, 4].map((i) => `documentos.seccion__a.bloques[0].items[${i}].url: enlace descartado (fuera de la lista blanca o demasiado largo)`));
      expect(adv.join('')).not.toContain('secreto-x');
    });

    it('descarta el ítem sin texto válido', () => {
      const adv: string[] = [];
      const c = contenidoDesdePublicado(sec([{ tipo: 'enlaces', items: [{ texto: '  ', url: ok.url }, ok] }]), negocioBase(), entorno, adv);
      expect(c.secciones[0]!.bloques[0]).toMatchObject({ items: [ok] });
      expect(adv).toEqual(['documentos.seccion__a.bloques[0].items[0].texto: ítem descartado (texto vacío o demasiado largo)']);
    });

    it('omite el bloque que queda vacío y conserva los demás', () => {
      const adv: string[] = [];
      const c = contenidoDesdePublicado(sec([{ tipo: 'enlaces', items: [{ texto: 'X', url: 'https://otro.invalid/' }] }, { tipo: 'texto', parrafos: ['p'] }]), negocioBase(), entorno, adv);
      expect(c.secciones[0]!.bloques.map((b) => b.tipo)).toEqual(['texto']);
      expect(adv).toContain('documentos.seccion__a.bloques[0]: bloque omitido (sin enlaces válidos)');
    });

    it('omite el carrusel de sección cuyas fotos se descartan... o no existen', () => {
      const adv: string[] = [];
      const c = contenidoDesdePublicado(sec([{ tipo: 'carrusel', items: [] }, { tipo: 'texto', parrafos: ['p'] }]), negocioBase(), entorno, adv);
      expect(c.secciones[0]!.bloques.map((b) => b.tipo)).toEqual(['texto']);
      expect(adv).toEqual(['documentos.seccion__a.bloques[0]: bloque omitido (carrusel sin fotos válidas)']);
    });

    it('omite la sección que queda sin bloques; no queda en el contenido y el orden se recompacta', () => {
      const adv: string[] = [];
      const c = contenidoDesdePublicado(sec([{ tipo: 'enlaces', items: [{ texto: 'X', url: 'https://otro.invalid/secreto-x' }] }]), negocioBase(), entorno, adv);
      expect(c.secciones.map((s) => [s.slug, s.orden])).toEqual([['b', 0]]);
      expect(adv).toContain('documentos.seccion__a: sección omitida (sin bloques válidos)');
      expect(adv.join('')).not.toContain('secreto-x');
    });

    it('una sección que ya venía sin bloques (vacía, ausente o no lista) se omite con advertencia', () => {
      for (const bloques of [[], undefined, 'x']) {
        const adv: string[] = [];
        const c = contenidoDesdePublicado(sec(bloques as unknown[]), negocioBase(), entorno, adv);
        expect(c.secciones.map((s) => s.slug)).toEqual(['b']);
        expect(adv).toEqual(['documentos.seccion__a: sección omitida (sin bloques)']);
      }
    });

    it('un bloque de tipo desconocido sigue lanzando, aun junto a enlaces descartados', () => {
      const adv: string[] = [];
      const bloques = [{ tipo: 'enlaces', items: [{ texto: 'X', url: 'https://otro.invalid/' }, ok] }, { tipo: 'html', html: '<b>x</b>' }];
      expect(() => contenidoDesdePublicado(sec(bloques), negocioBase(), entorno, adv)).toThrow(ErrorContenidoPublicado);
    });

    it('conserva tel: y mailto: válidos', () => {
      const items = [{ texto: 'Llamar', url: 'tel:+59170000000' }, { texto: 'Correo', url: 'mailto:hola@ejemplo.invalid' }];
      const adv: string[] = [];
      const c = contenidoDesdePublicado(sec([{ tipo: 'enlaces', items }]), negocioBase(), entorno, adv);
      expect(c.secciones[0]!.bloques[0]).toMatchObject({ items });
      expect(adv).toEqual([]);
    });

    it('un ítem que no es objeto produce su advertencia y se descarta', () => {
      const adv: string[] = [];
      const c = contenidoDesdePublicado(sec([{ tipo: 'enlaces', items: ['x', 5, null, ok] }]), negocioBase(), entorno, adv);
      expect(c.secciones[0]!.bloques[0]).toMatchObject({ items: [ok] });
      expect(adv).toEqual([0, 1, 2].map((i) => `documentos.seccion__a.bloques[0].items[${i}]: ítem descartado (no es un objeto)`));
    });

    it('título de enlaces o de texto vacío o demasiado largo se quita con advertencia y el contenido es válido', () => {
      for (const titulo of ['   ', 'T'.repeat(121)]) {
        const adv: string[] = [];
        const c = contenidoDesdePublicado(sec([{ tipo: 'enlaces', titulo, items: [ok] }, { tipo: 'texto', titulo, parrafos: ['p'] }]), negocioBase(), entorno, adv);
        expect(c.secciones[0]!.bloques).toEqual([{ tipo: 'enlaces', items: [ok] }, { tipo: 'texto', parrafos: ['p'] }]);
        expect(adv).toEqual([0, 1].map((k) => `documentos.seccion__a.bloques[${k}].titulo: título descartado (vacío o demasiado largo)`));
      }
    });

    it('un bloque de texto sin párrafos válidos se omite con advertencia (no tumba el sitio)', () => {
      const adv: string[] = [];
      const c = contenidoDesdePublicado(
        sec([{ tipo: 'texto', parrafos: [] }, { tipo: 'texto', parrafos: ['  '] }, { tipo: 'texto', parrafos: ['p'.repeat(3001)] }, { tipo: 'texto', parrafos: ['ok'] }]),
        negocioBase(), entorno, adv);
      expect(c.secciones[0]!.bloques).toEqual([{ tipo: 'texto', parrafos: ['ok'] }]);
      expect(adv).toEqual([0, 1, 2].map((k) => `documentos.seccion__a.bloques[${k}]: bloque omitido (texto vacío o fuera de los límites)`));
    });

    it('imagen sin versión válida: se omite con advertencia', () => {
      const adv: string[] = [];
      const c = contenidoDesdePublicado(sec([{ tipo: 'imagen', medio: { versiones: [] } }, { tipo: 'texto', parrafos: ['p'] }]), negocioBase(), entorno, adv);
      expect(c.secciones[0]!.bloques.map((b) => b.tipo)).toEqual(['texto']);
      expect(adv).toEqual(['documentos.seccion__a.bloques[0]: bloque omitido (imagen sin versión válida)']);
    });
  });

  it('trae la versión y la fecha de publicación del estado (o del sitio, o nulas)', () => {
    const c = contenidoDesdePublicado(respuesta({}, { version: 7, publicadoEn: '2026-11-10T12:00:00.000Z' }), negocioBase(), entorno);
    expect(c.publicacion).toEqual({ version: 7, publicadoEn: '2026-11-10T12:00:00.000Z' });
    const sinFecha = contenidoDesdePublicado(respuesta(), negocioBase(), entorno);
    expect(sinFecha.publicacion).toEqual({ version: 3, publicadoEn: null });
  });
});

describe('negocio desde la consola (publicado/negocio)', () => {
  // Documento tal como lo publica la consola: sin mercados, logo ni número de WhatsApp; con version y actualizadoEn.
  const docConsola = (extra: Record<string, unknown> = {}) => {
    const resto: Record<string, unknown> = { ...negocioBase() };
    for (const k of ['mercados', 'mercadoInicial', 'logo', 'whatsappTienda']) delete resto[k];
    return { ...resto, version: 4, actualizadoEn: '2026-11-17T10:00:00.000Z', ...extra };
  };
  const con = (doc: unknown) => respuesta({ negocio: doc });
  const logoSecreto = { url: `${MEDIOS}/bucket/logo.webp`, alt: 'Logo', versiones: [] };
  const medioIdentidad = { tipo: 'foto', alt: 'Equipo', ancho: 1000, alto: 800, versiones: [{ clase: 'imagen', lado: 960, formato: 'webp', ruta: 'm/id/960.webp' }] };

  it('sin documento: igual que hoy, sin avisos nuevos y fuente «respaldo»', () => {
    const av: string[] = [];
    const c = contenidoDesdePublicado(respuesta(), negocioBase(), entorno, av);
    expect(c).toEqual(contenidoDesdePublicado(respuesta(), negocioBase(), entorno));
    expect(av).toEqual([]);
    expect(contenidoYFuenteDesdePublicado(respuesta(), negocioBase(), entorno)).toEqual({ contenido: c, fuenteNegocio: 'respaldo' });
  });

  it('con documento: cada campo sale del documento; mercados y logo del secreto', () => {
    const secreto = { ...negocioBase(), nombre: 'Del secreto', mercados: ['BO'], mercadoInicial: 'BO', logo: logoSecreto };
    const doc = docConsola({ nombre: 'De la consola', lema: 'Lema consola', telefono: '+59170000001', correo: 'a@ejemplo.invalid', direccion: 'Otra 1', horario: 'Lun 9-18' });
    const av: string[] = [];
    const c = contenidoDesdePublicado(con(doc), secreto, entorno, av);
    expect(contenidoYFuenteDesdePublicado(con(doc), secreto, entorno).fuenteNegocio).toBe('consola');
    expect(av).toEqual([]);
    expect(c.config).toMatchObject({ nombre: 'De la consola', lema: 'Lema consola', telefono: '+59170000001', correo: 'a@ejemplo.invalid', direccion: 'Otra 1', horario: 'Lun 9-18', mercados: ['BO'], mercadoInicial: 'BO', logo: logoSecreto, whatsappNovuchat: '59170000000' });
  });

  it('documento con los mismos datos que el secreto: Contenido y huella idénticos', () => {
    const a = contenidoDesdePublicado(respuesta(), negocioBase(), entorno);
    const b = contenidoDesdePublicado(con(docConsola()), negocioBase(), entorno);
    expect(b).toEqual(a);
    expect(huellaContenido(b)).toBe(huellaContenido(a));
  });

  it('destacados y categorías salen del documento', () => {
    const c = contenidoDesdePublicado(con(docConsola({ destacados: ['p-dos'], categorias: { 'parlantes-audio': { nombre: 'Sonido', icono: 'cuadricula' } } })), negocioBase(), entorno);
    expect(c.productos.find((p) => p.id === 'p-dos')?.destacado).toBe(true);
    expect(c.categorias.find((k) => k.id === 'parlantes-audio')?.nombre).toBe('Sonido');
  });

  it('foto de identidad como medio de la consola: se resuelve a la base de medios', () => {
    const doc = docConsola({ identidad: { ...negocioBase().identidad, foto: medioIdentidad } });
    const c = contenidoDesdePublicado(con(doc), negocioBase(), { ...entorno, baseMedios: `${MEDIOS}/bucket` });
    expect(c.identidad.foto).toEqual({ url: `${MEDIOS}/bucket/m/id/960.webp`, alt: 'Equipo', versiones: [{ url: `${MEDIOS}/bucket/m/id/960.webp`, ancho: 960 }] });
  });

  it('foto de identidad heredada: pasa tal cual', () => {
    const heredada = { url: `${MEDIOS}/x/foto.webp`, alt: 'Heredada' };
    const c = contenidoDesdePublicado(con(docConsola({ identidad: { ...negocioBase().identidad, foto: heredada } })), negocioBase(), entorno);
    expect(c.identidad.foto).toEqual(heredada);
  });

  it('foto de identidad de otro origen: el documento no pasa y se usa el respaldo', () => {
    const mala = { url: 'https://otro.ejemplo.invalid/x.webp', alt: 'x' };
    const av: string[] = [];
    const c = contenidoDesdePublicado(con(docConsola({ nombre: 'Nombre Consola', identidad: { ...negocioBase().identidad, foto: mala } })), negocioBase(), entorno, av);
    expect(c.config.nombre).toBe('Tienda de Ejemplo');
    expect(av).toEqual([expect.stringMatching(/^documentos\.negocio\.identidad\.foto\.url: /), 'documentos.negocio: datos de la consola no válidos; se usó el respaldo']);
    expect(av.join('\n')).not.toContain('otro.ejemplo.invalid');
    expect(contenidoYFuenteDesdePublicado(con(docConsola({ identidad: { ...negocioBase().identidad, foto: mala } })), negocioBase(), entorno).fuenteNegocio).toBe('respaldo');
  });

  it('documento inválido: respaldo con aviso sin valores', () => {
    const av: string[] = [];
    const c = contenidoDesdePublicado(con(docConsola({ nombre: 'Valor Secreto', correo: 5 })), negocioBase(), entorno, av);
    expect(c.config.nombre).toBe('Tienda de Ejemplo');
    expect(av).toEqual([expect.stringMatching(/^documentos\.negocio\.correo: /), 'documentos.negocio: datos de la consola no válidos; se usó el respaldo']);
    expect(av.join('\n')).not.toContain('Valor Secreto');
  });

  it('documento inválido y sin respaldo válido: error', () => {
    expect(() => contenidoDesdePublicado(con(docConsola({ nombre: '' })), { ...negocioBase(), mercados: [] }, entorno)).toThrow(/negocio\.mercados/);
  });

  it('el fallo solo en campos del respaldo no se achaca a la consola: aviso del respaldo y error', () => {
    const av: string[] = [];
    expect(() => contenidoDesdePublicado(con(docConsola()), { ...negocioBase(), mercados: [] }, entorno, av)).toThrow(ErrorContenidoPublicado);
    expect(av).toEqual(['negocio: el respaldo no es válido (negocio.mercados, negocio.mercadoInicial)']);
    expect(av.join('\n')).not.toContain('datos de la consola');
  });

  it('un error del documento y otro del respaldo: se culpa a la consola', () => {
    const av: string[] = [];
    expect(() => contenidoDesdePublicado(con(docConsola({ correo: 5 })), { ...negocioBase(), mercados: [] }, entorno, av)).toThrow(/negocio\.mercados/);
    expect(av).toContain('documentos.negocio.correo: debe ser texto de 5 a 120 caracteres');
    expect(av).toContain('documentos.negocio: datos de la consola no válidos; se usó el respaldo');
  });

  it('foto de identidad de la consola sin versión válida: queda en null con aviso y el resto del documento se usa', () => {
    const av: string[] = [];
    const doc = docConsola({ nombre: 'Nombre Consola', identidad: { ...negocioBase().identidad, foto: { tipo: 'foto', alt: 'x', versiones: [] } } });
    const r = contenidoYFuenteDesdePublicado(con(doc), negocioBase(), entorno, av);
    expect(r.fuenteNegocio).toBe('consola');
    expect(r.contenido.config.nombre).toBe('Nombre Consola');
    expect(r.contenido.identidad.foto).toBeNull();
    expect(av).toEqual(['documentos.negocio.identidad.foto: foto omitida (sin versión válida)']);
  });

  it('documento ausente o descartado: fuente efectiva «respaldo»', () => {
    expect(contenidoYFuenteDesdePublicado(con('texto'), negocioBase(), entorno).fuenteNegocio).toBe('respaldo');
    expect(contenidoYFuenteDesdePublicado(con(docConsola()), negocioBase(), entorno).fuenteNegocio).toBe('consola');
  });

  describe('invariante: el documento con los mismos datos no mueve el contenido ni las huellas', () => {
    const host = (n: number) => `h${n}.ejemplo.invalid`;
    const completo = () => {
      const c = contenidoEjemplo;
      return {
        ...negocioBase(),
        nombre: 'Tienda Completa', lema: 'Lema completo', telefono: '+59170000001', correo: 'hola@ejemplo.invalid', horario: 'Lun a Sáb 9:00-18:00',
        direccion: 'Av. Ficticia 456',
        logo: { url: `${MEDIOS}/bucket/logo.webp`, alt: 'Logo', versiones: [{ url: `${MEDIOS}/bucket/logo-480.webp`, ancho: 480 }] },
        whatsappTienda: '59171111111',
        enlacesPermitidos: [1, 2, 3, 4].map(host),
        categorias: { 'aire-acondicionado': { nombre: 'Climas', icono: 'aire' }, 'parlantes-audio': { nombre: 'Sonido', icono: 'parlante' } },
        destacados: ['p-dos', 'p-uno'],
        beneficios: Array.from({ length: 8 }, (_, i) => ({ ...c.beneficios[0]!, descripcion: `Beneficio ${i}` })),
        identidad: {
          ...c.identidad,
          foto: { url: `${MEDIOS}/x/foto.webp`, alt: 'Equipo', versiones: [{ url: `${MEDIOS}/x/foto-480.webp`, ancho: 480 }, { url: `${MEDIOS}/x/foto-960.webp`, ancho: 960 }] },
          cifra: { valor: { texto: '15 años', confirmada: true }, detalle: 'De trayectoria' },
          sello: { texto: 'Garantía propia', confirmada: false },
          valores: Array.from({ length: 6 }, (_, i) => ({ icono: 'cuadricula', titulo: `Valor ${i}`, texto: `Texto del valor ${i}` })),
        },
        textoPrivacidad: ['Párrafo uno.', 'Párrafo dos.', 'Párrafo tres.'],
      };
    };
    const comoConsola = (n: Record<string, unknown>) => {
      const resto: Record<string, unknown> = { ...n };
      for (const k of ['mercados', 'mercadoInicial', 'logo', 'whatsappTienda']) delete resto[k];
      return { ...resto, version: 9, actualizadoEn: '2026-11-17T10:00:00.000Z' };
    };
    const vacio = () => ({ ...negocioBase(), identidad: { ...contenidoEjemplo.identidad, foto: null, cifra: null, valores: [], sello: { texto: 'Sello', confirmada: false } }, beneficios: [], textoPrivacidad: ['Uno.'], enlacesPermitidos: [], categorias: {}, destacados: [] });
    const entornoMedios: EntornoSitio = { ...entorno, disponibilidad: { 'p-uno': true, 'p-dos': false } };

    for (const [nombre, hacer] of [['todos los campos llenos', completo], ['todos los opcionales nulos o vacíos', vacio]] as const) {
      it(nombre, () => {
        const secreto = hacer();
        const av: string[] = [];
        const a = contenidoYFuenteDesdePublicado(respuesta(), secreto, entornoMedios);
        const b = contenidoYFuenteDesdePublicado(con(comoConsola(secreto)), secreto, entornoMedios, av);
        expect(av).toEqual([]);
        expect(a.fuenteNegocio).toBe('respaldo');
        expect(b.fuenteNegocio).toBe('consola');
        if (nombre.startsWith('todos los campos')) {
          expect(b.contenido.config).toMatchObject({ telefono: '+59170000001', correo: 'hola@ejemplo.invalid', horario: 'Lun a Sáb 9:00-18:00' });
          expect(b.contenido.config.enlacesPermitidos).toHaveLength(4);
          expect(b.contenido.beneficios).toHaveLength(8);
          expect(b.contenido.identidad.foto?.versiones).toHaveLength(2);
          expect(b.contenido.productos.filter((p) => p.destacado)).toHaveLength(2);
        }
        expect(b.contenido).toEqual(a.contenido);
        expect(huellaContenido(b.contenido)).toBe(huellaContenido(a.contenido));
        expect(huellaSinDisponibilidad(b.contenido)).toBe(huellaSinDisponibilidad(a.contenido));
      });
    }
  });

  it('documento no objeto: respaldo con aviso', () => {
    const av: string[] = [];
    contenidoDesdePublicado(con('texto'), negocioBase(), entorno, av);
    expect(av).toContain('documentos.negocio: datos de la consola no válidos; se usó el respaldo');
  });
});

describe('causas saneadas del error', () => {
  const capturar = (r: unknown, n: unknown = negocioBase()): ErrorContenidoPublicado => {
    try { contenidoDesdePublicado(r, n, entorno); } catch (e) { return e as ErrorContenidoPublicado; }
    throw new Error('debía fallar');
  };
  it('un precio fuera de tope señala producto y mercado', () => {
    const r = respuesta({ producto__uno: prod('p-uno', { precioUSD: { bo: 2_000_000, ar: 120 } }) });
    const e = capturar(r);
    expect(e.causas).toEqual([{ codigo: 'precio_fuera_de_tope', productoId: 'p-uno', mercado: 'BO' }]);
  });
  it('una categoría inválida señala el primer producto que la usa', () => {
    const r = respuesta({ producto__uno: prod('p-uno', { categoria: 'Categoría Mala!' }) });
    const e = capturar(r);
    expect(e.causas.some((c) => c.codigo === 'categoria_invalida' && c.productoId === 'p-uno')).toBe(true);
  });
  it('más categorías que el tope: demasiadas_categorias', () => {
    const extra: Record<string, unknown> = {};
    for (let i = 0; i <= MAX_CATEGORIAS_SITIO; i += 1) extra[`producto__c${i}`] = prod(`c${i}`, { categoria: `cat-${i}` });
    const e = capturar(respuesta(extra));
    expect(e.causas).toContainEqual({ codigo: 'demasiadas_categorias' });
  });
  it('otros errores: contenido_invalido sin datos, una sola vez', () => {
    const e = capturar({}, negocioBase());
    expect(e.causas).toEqual([{ codigo: 'contenido_invalido' }]);
  });
  it('las causas no llevan texto libre', () => {
    const r = respuesta({ producto__uno: prod('p-uno', { precioUSD: { bo: 2_000_000, ar: 120 } }) });
    expect(JSON.stringify(capturar(r).causas)).not.toContain('Producto p-uno');
  });
});
