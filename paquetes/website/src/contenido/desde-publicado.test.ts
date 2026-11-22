import { MAX_CATEGORIAS_SITIO } from '@novutienda/nucleo';
import { describe, expect, it } from 'vitest';
import { ErrorContenidoPublicado, contenidoDesdePublicado, iconoDeCategoria, nombreDeCategoria, type EntornoSitio } from './desde-publicado.js';
import { contenidoEjemplo } from './ejemplo.js';
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

describe('campos opcionales en el contenido publicado', () => {
  it('sin institucional ni características, la salida no trae las claves', () => {
    const c = contenidoDesdePublicado(respuesta(), negocioBase(), entorno);
    expect('institucional' in c).toBe(false);
    expect(c.productos.some((p) => 'caracteristicas' in p)).toBe(false);
  });
  it('copia institucional del negocio y valida sus límites', () => {
    const inst = { mision: 'm', chat: { mensajes: [{ de: 'cliente', texto: 'hola' }] } };
    expect(contenidoDesdePublicado(respuesta(), { ...negocioBase(), institucional: inst }, entorno).institucional).toEqual(inst);
    expect(() => contenidoDesdePublicado(respuesta(), { ...negocioBase(), institucional: { vision: '' } }, entorno)).toThrow();
  });
  it('características: recorta, descarta vacías y largas con aviso, topa en 8; sin ninguna, no hay clave', () => {
    const avisos: string[] = [];
    const lista = ['  uno ', '', 'x'.repeat(161), 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'];
    const c = contenidoDesdePublicado(respuesta({ producto__tres: prod('p-tres', { caracteristicas: lista }), producto__cuatro: prod('p-cuatro', { caracteristicas: ['', ' '] }) }), negocioBase(), entorno, avisos);
    expect(c.productos.find((p) => p.id === 'p-tres')!.caracteristicas).toEqual(['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho']);
    expect('caracteristicas' in c.productos.find((p) => p.id === 'p-cuatro')!).toBe(false);
    expect(avisos.filter((a) => a.includes('caracteristicas')).length).toBeGreaterThanOrEqual(4);
  });
});
