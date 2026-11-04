import { describe, expect, it } from 'vitest';
import { contenidoEjemplo } from './ejemplo.js';
import { LIMITES_SITIO, type Contenido, type Producto } from './tipos.js';
import { origenValido, urlEnlaceSegura, urlMedioSegura, validarContenido } from './validar.js';

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
    const c = clon() as unknown as Contenido & Record<string, unknown>;
    (c.config as Record<string, unknown>)['plantilla'] = 'rosa-neon';
    (c as Record<string, unknown>)['marcas'] = 'no-es-lista';
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
    expect(e).toContain('redondeo.BOB.decimales');
    expect(e).toContain('redondeo.ARS.modo');
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
});
