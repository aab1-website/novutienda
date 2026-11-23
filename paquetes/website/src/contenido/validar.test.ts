import { describe, expect, it } from 'vitest';
import { contenidoEjemplo } from './ejemplo.js';
import { LIMITES_SITIO, type Producto } from './tipos.js';
import { origenValido, urlEnlaceSegura, urlMapaSegura, urlMedioSegura, validarContenido } from './validar.js';

const clon = (): Record<string, unknown> => JSON.parse(JSON.stringify(contenidoEjemplo)) as Record<string, unknown>;
const errores = (c: unknown): readonly string[] => {
  const r = validarContenido(c);
  return r.ok ? [] : r.errores;
};
const producto = (n: number): Producto => ({ ...(contenidoEjemplo.productos[0] as Producto), id: `p-${n}`, slug: `p-${n}` });

describe('validarContenido', () => {
  it('acepta el contenido de ejemplo y lo marca como ejemplo', () => {
    const r = validarContenido(contenidoEjemplo);
    expect(r.ok).toBe(true);
    expect(r.ok && r.contenido.config.esEjemplo).toBe(true);
  });

  it('rechaza lo que no es un objeto y reúne todos los errores, no solo el primero', () => {
    expect(errores(null).length).toBeGreaterThan(0);
    const c = clon();
    (c['config'] as Record<string, unknown>)['plantilla'] = 'rosa-neon';
    c['marcas'] = 'no-es-lista';
    expect(errores(c).length).toBeGreaterThanOrEqual(2);
  });

  it('la plantilla es una lista cerrada', () => {
    const c = clon();
    (c['config'] as Record<string, unknown>)['plantilla'] = 'otra';
    expect(errores(c).join()).toContain('config.plantilla');
  });

  it('respeta el tope de 200 productos', () => {
    const c = { ...contenidoEjemplo, productos: Array.from({ length: LIMITES_SITIO.productos }, (_, i) => producto(i)) };
    expect(validarContenido(c).ok).toBe(true);
    const demas = { ...c, productos: [...c.productos, producto(999)] };
    expect(errores(demas).join()).toContain('productos');
  });

  it('rechaza una sexta foto, identificadores inválidos y duplicados', () => {
    const base = contenidoEjemplo.productos[0] as Producto;
    const f = base.fotos[0]!;
    expect(errores({ ...contenidoEjemplo, productos: [{ ...base, fotos: Array(6).fill(f) }] }).join()).toContain('fotos');
    expect(errores({ ...contenidoEjemplo, productos: [{ ...base, id: 'A B' }] }).join()).toContain('.id');
    expect(errores({ ...contenidoEjemplo, productos: [base, { ...base }] }).join()).toContain('duplicado');
  });

  it('rechaza categoría inexistente, precio negativo y video con origen no declarado', () => {
    const base = contenidoEjemplo.productos[0] as Producto;
    expect(errores({ ...contenidoEjemplo, productos: [{ ...base, categoria: 'fantasma' }] }).join()).toContain('categoría inexistente');
    expect(errores({ ...contenidoEjemplo, productos: [{ ...base, precioUsd: { BO: -1, AR: 1 } }] }).join()).toContain('precioUsd.BO');
    const v = { url: 'https://malo.example/v.mp4', poster: '/ejemplo/producto-1.svg', titulo: 'x' };
    expect(errores({ ...contenidoEjemplo, productos: [{ ...base, video: v }] }).join()).toContain('video.url');
  });

  it('admite hasta 5 secciones y no una sexta', () => {
    const s = contenidoEjemplo.secciones[0]!;
    const cinco = Array.from({ length: 5 }, (_, i) => ({ ...s, id: `s${i}`, slug: `s${i}` }));
    expect(validarContenido({ ...contenidoEjemplo, secciones: cinco }).ok).toBe(true);
    expect(errores({ ...contenidoEjemplo, secciones: [...cinco, { ...s, id: 's9', slug: 's9' }] }).join()).toContain('secciones');
  });

  it('los bloques son tipados: nunca HTML libre; los enlaces van por lista blanca', () => {
    const s = contenidoEjemplo.secciones[0]!;
    const con = (bloque: unknown): readonly string[] => errores({ ...contenidoEjemplo, secciones: [{ ...s, bloques: [bloque] }] });
    expect(con({ tipo: 'html', html: '<script>alert(1)</script>' }).join()).toContain('bloque desconocido');
    expect(con({ tipo: 'enlaces', items: [{ texto: 'x', url: 'https://evil.example/' }] }).join()).toContain('lista blanca');
    expect(con({ tipo: 'enlaces', items: [{ texto: 'x', url: 'javascript:alert(1)' }] }).join()).toContain('lista blanca');
    expect(con({ tipo: 'enlaces', items: [{ texto: 'x', url: 'https://www.ejemplo.invalid/' }] })).toEqual([]);
    expect(con({ tipo: 'carrusel', fotos: [] }).join()).toContain('fotos');
  });

  it('valida el formato de los identificadores de medición y de reCAPTCHA', () => {
    const c = clon();
    const cfg = c['config'] as Record<string, unknown>;
    cfg['medicion'] = { google: 'G-1"><script>', searchConsole: null, meta: 'abc', tiktok: null };
    cfg['recaptchaSiteKey'] = 'no valida!';
    const e = errores(c).join();
    expect(e).toContain('medicion.google');
    expect(e).toContain('medicion.meta');
    expect(e).toContain('recaptchaSiteKey');
  });

  it('valida el bloque de App Check: formato de cada identificador; ausente equivale a null', () => {
    const c = clon();
    const cfg = c['config'] as Record<string, unknown>;
    expect(errores(c)).toEqual([]);
    delete cfg['appCheck'];
    expect(errores(c)).toEqual([]);
    cfg['appCheck'] = { claveSitio: 'corta', apiKey: 'x"><script>', appId: 'no', projectId: 'A' };
    const e = errores(c).join();
    for (const k of ['claveSitio', 'apiKey', 'appId', 'projectId']) expect(e).toContain(`appCheck.${k}`);
    cfg['appCheck'] = null;
    expect(errores(c)).toEqual([]);
  });

  it('exige números de WhatsApp solo con dígitos o null', () => {
    const c = clon();
    (c['config'] as Record<string, unknown>)['whatsappNovuchat'] = '+591 700';
    expect(errores(c).join()).toContain('whatsappNovuchat');
    (c['config'] as Record<string, unknown>)['whatsappNovuchat'] = null;
    (c['config'] as Record<string, unknown>)['whatsappTienda'] = null;
    expect(validarContenido(c).ok).toBe(true);
  });

  it('valida la regla de redondeo', () => {
    const c = clon();
    (c['config'] as Record<string, unknown>)['redondeo'] = { BOB: { tipo: 'decimales', decimales: 9, modo: 'cercano' }, ARS: { tipo: 'multiplo', multiplo: 0, modo: 'raro' } };
    const e = errores(c).join();
    expect(e).toContain('redondeo.BOB');
    expect(e).toContain('redondeo.ARS');
  });

  it.each([
    ['ninguno', { tipo: 'ninguno', modo: 'cercano' }],
    ['decimales: 3', { tipo: 'decimales', decimales: 3, modo: 'cercano' }],
    ['decimales: 1.5', { tipo: 'decimales', decimales: 1.5, modo: 'cercano' }],
    ['multiplo: 0.015', { tipo: 'multiplo', multiplo: 0.015, modo: 'cercano' }],
  ])('rechaza la regla de redondeo %s', (_n, regla) => {
    const c = clon();
    (c['config'] as Record<string, unknown>)['redondeo'] = { BOB: regla };
    expect(errores(c).join()).toContain('redondeo.BOB');
  });

  it('acepta cero productos y cero categorías, y carruseles sin fotos (el sitio se reconstruye sin catálogo)', () => {
    const c = clon();
    c['productos'] = [];
    c['categorias'] = [];
    c['marcas'] = [];
    for (const k of Object.keys(c['carruseles'] as object)) (c['carruseles'] as Record<string, unknown>)[k] = [];
    expect(errores(c)).toEqual([]);
  });

  it('un carrusel de plantilla no pasa de 8 fotos', () => {
    const c = clon();
    const car = c['carruseles'] as Record<string, unknown[]>;
    car['cielo'] = Array.from({ length: 9 }, () => (car['cielo'] as unknown[])[0]);
    expect(errores(c).join()).toContain('carruseles.cielo');
  });

  it('cada plantilla debe tener su carrusel', () => {
    const c = clon();
    delete (c['carruseles'] as Record<string, unknown>)['bosque'];
    expect(errores(c).join()).toContain('carruseles.bosque');
  });
});

describe('URL seguras', () => {
  it('origenValido acepta https y localhost, no rutas ni credenciales', () => {
    expect(origenValido('https://sitio.example')).toBe(true);
    expect(origenValido('http://localhost')).toBe(true);
    expect(origenValido('http://sitio.example')).toBe(false);
    expect(origenValido('https://sitio.example/ruta')).toBe(false);
    expect(origenValido('https://u:p@sitio.example')).toBe(false);
    expect(origenValido(42)).toBe(false);
  });
  it('urlMedioSegura: ruta propia u origen declarado', () => {
    expect(urlMedioSegura('/a.png', [])).toBe(true);
    expect(urlMedioSegura('//evil.example/a.png', [])).toBe(false);
    expect(urlMedioSegura('/a\\b', [])).toBe(false);
    expect(urlMedioSegura('https://cdn.example/a.png', ['https://cdn.example'])).toBe(true);
    expect(urlMedioSegura('https://cdn.example/a.png', [null])).toBe(false);
    expect(urlMedioSegura('no es url', [])).toBe(false);
  });
  it('urlEnlaceSegura: ruta propia, tel, mailto y anfitriones permitidos', () => {
    expect(urlEnlaceSegura('/productos', [])).toBe(true);
    expect(urlEnlaceSegura('//evil.example', [])).toBe(false);
    expect(urlEnlaceSegura('tel:+59100000000', [])).toBe(true);
    expect(urlEnlaceSegura('mailto:a@ejemplo.invalid', [])).toBe(true);
    expect(urlEnlaceSegura('mailto:a b@x', [])).toBe(false);
    expect(urlEnlaceSegura('https://ok.example/x', ['ok.example'])).toBe(true);
    expect(urlEnlaceSegura('https://ok.example/x', [])).toBe(false);
    expect(urlEnlaceSegura('http://ok.example/x', ['ok.example'])).toBe(false);
    expect(urlEnlaceSegura('data:text/html,hola', ['ok.example'])).toBe(false);
  });

  it('el enlace de una foto de carrusel pasa por la lista blanca; la publicación es opcional y validada', () => {
    const con = (enlace: unknown, pub?: unknown): readonly string[] => {
      const c = clon();
      const car = c['carruseles'] as Record<string, Record<string, unknown>[]>;
      car['cielo']![0]!['enlace'] = enlace;
      if (pub !== undefined) c['publicacion'] = pub;
      return errores(c);
    };
    expect(con('/productos')).toEqual([]);
    expect(con('https://www.ejemplo.invalid/x')).toEqual([]);
    expect(con('https://evil.example/').join()).toContain('carruseles.cielo[0].enlace: enlace fuera de la lista blanca');
    expect(con('/productos', { version: 2, publicadoEn: '2026-11-10T12:00:00Z' })).toEqual([]);
    expect(con('/productos', { version: 1.5, publicadoEn: 'ayer' }).join()).toContain('publicacion');
  });
});

describe('campos opcionales: institucional y características', () => {
  const con = (extra: Record<string, unknown>): Record<string, unknown> => ({ ...clon(), ...extra });
  const sinInst = (): Record<string, unknown> => { const c = clon(); delete c['institucional']; return c; };

  it('ausentes: el contenido es válido y la salida no trae las claves', () => {
    const c = sinInst();
    for (const p of c['productos'] as Record<string, unknown>[]) delete p['caracteristicas'];
    const r = validarContenido(c);
    expect(r.ok).toBe(true);
    expect(r.ok && 'institucional' in r.contenido).toBe(false);
    expect(r.ok && r.contenido.productos.some((p) => 'caracteristicas' in p)).toBe(false);
  });
  it('acepta institucional completo', () => {
    expect(errores(con({ institucional: { mision: 'm', vision: 'v', chat: { mensajes: [{ de: 'cliente', texto: 'hola' }] } } }))).toEqual([]);
  });
  it('rechaza misión larga, chat vacío, de más de 6 o con emisor inválido', () => {
    expect(errores(con({ institucional: { mision: 'x'.repeat(601) } }))).toContain('institucional.mision: debe ser un texto de 1 a 600 caracteres');
    expect(errores(con({ institucional: { chat: { mensajes: [] } } }))).toHaveLength(1);
    const siete = Array.from({ length: 7 }, () => ({ de: 'cliente', texto: 'a' }));
    expect(errores(con({ institucional: { chat: { mensajes: siete } } }))).toHaveLength(1);
    expect(errores(con({ institucional: { chat: { mensajes: [{ de: 'robot', texto: 'a' }] } } }))).toEqual(["institucional.chat.mensajes[0].de: debe ser 'cliente' o 'comercio'"]);
  });
  it('caracteristicas: de 1 a 8 viñetas de hasta 160 caracteres', () => {
    const conCar = (v: unknown): readonly string[] => {
      const c = clon();
      (c['productos'] as Record<string, unknown>[])[0]!['caracteristicas'] = v;
      return errores(c);
    };
    expect(conCar(['a', 'b'])).toEqual([]);
    expect(conCar([])).toHaveLength(1);
    expect(conCar(Array.from({ length: 9 }, () => 'a'))).toHaveLength(1);
    expect(conCar(['x'.repeat(161)])).toHaveLength(1);
    expect(conCar([' '])).toHaveLength(1);
    expect(conCar('texto')).toHaveLength(1);
  });
});

describe('enlace al mapa (Google Maps)', () => {
  it('acepta solo https a los anfitriones de Google Maps', () => {
    for (const u of [
      'https://www.google.com/maps/place/Tienda+Ejemplo/@-17.39,-66.15,17z', 'https://www.google.com/maps?q=-17.39,-66.15',
      'https://maps.google.com/?q=tienda', 'https://maps.app.goo.gl/AbC123', 'https://goo.gl/maps/AbC123',
    ]) expect(urlMapaSegura(u), u).toBe(true);
  });
  it('rechaza otros anfitriones, esquemas peligrosos, credenciales, puertos y excesos de largo', () => {
    for (const u of [
      'https://maps.google.com:443/x', 'https://maps.google.com:/x', 'https:///maps.google.com/x', 'https:/maps.google.com/x',
      'https://maps.google.com\\@evil.com/x', 'https://maps.google%2ecom/x', 'https://maps.google.\uff43om/x', 'https://MAPS.GOOGLE.COM/x',
      'https://www.google.com/maps/../url?q=https://evil.com', 'https://www.google.com/maps/%2e%2e/url?q=x', 'https://www.google.com/maps/%2E./url?q=x',
      'https://goo.gl/maps/../abc', 'https://maps.app.goo.gl/./x', 'javascript:alert(1)', 'http://www.google.com/maps', 'https://www.google.com/search?q=maps', 'https://www.google.com/mapsx', 'https://goo.gl/otra',
      'https://google.com/maps', 'https://evil.com/maps', 'https://www.google.com.evil.com/maps', 'https://usuario@www.google.com/maps',
      'https://www.google.com:8443/maps', 'https://maps.google.com/ruta con espacio', `https://maps.app.goo.gl/${'a'.repeat(1000)}`, '', 'data:text/html,x',
    ]) expect(urlMapaSegura(u), u).toBe(false);
  });
  it('en el contenido: opcional, y si viene inválido falla con la ruta (sin copiar el valor)', () => {
    expect(errores(clon())).toEqual([]);
    const ok = clon();
    (ok['config'] as Record<string, unknown>)['mapa'] = 'https://maps.app.goo.gl/AbC123';
    const r = validarContenido(ok);
    expect(r.ok && r.contenido.config.mapa).toBe('https://maps.app.goo.gl/AbC123');
    const mal = clon();
    (mal['config'] as Record<string, unknown>)['mapa'] = 'javascript:alert(1)';
    const e = errores(mal);
    expect(e.some((x) => x.startsWith('config.mapa:'))).toBe(true);
    expect(e.join()).not.toContain('alert');
  });
});
