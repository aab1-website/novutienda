import { describe, expect, it } from 'vitest';
import { contenidoDesdePublicado, type EntornoSitio } from './desde-publicado.js';
import { contenidoEjemplo } from './ejemplo.js';
import { iconoDelSitio, imagenAlCompartir } from './logo-subido.js';

// Todo inventado: dominios .invalid.
const MEDIOS = 'https://medios.ejemplo.invalid';
const entorno: EntornoSitio = {
  origen: 'https://tienda.ejemplo.invalid', origenMedios: MEDIOS, appCheck: null, recaptchaSiteKey: null, disponibilidad: {},
};
const P = 'tenants/t-ejemplo/publico/medios/_negocio';
const logoOk = {
  ancho: 512, alto: 512,
  versiones: [
    { formato: 'webp', lado: 64, ruta: `${P}/l64.webp` }, { formato: 'webp', lado: 256, ruta: `${P}/l256.webp` },
    { formato: 'png', lado: 64, ruta: `${P}/l64.png` }, { formato: 'png', lado: 512, ruta: `${P}/l512.png` },
  ],
};
const manual = { url: `${MEDIOS}/manual/logo.png`, alt: 'Logo escrito a mano' };
const negocio = (logo: unknown = null) => {
  const c = contenidoEjemplo;
  return {
    nombre: 'Tienda de Ejemplo', lema: 'Lema', logo, whatsappTienda: null, telefono: null, correo: null,
    direccion: 'Calle Ficticia 123', horario: null, mercados: ['BO', 'AR'], mercadoInicial: 'BO', enlacesPermitidos: ['ejemplo.invalid'],
    portada: c.portada, beneficios: c.beneficios, identidad: { ...c.identidad, foto: null }, textoPrivacidad: ['Texto de ejemplo.'],
    categorias: {}, destacados: [],
  };
};
const redondeo = { BOB: { tipo: 'decimales', decimales: 2, modo: 'cercano' }, ARS: { tipo: 'multiplo', multiplo: 500, modo: 'arriba' } };
const resp = (logo?: unknown) => ({
  redondeo,
  documentos: {
    sitio: { plantillaActiva: 'bosque', medicion: {}, version: 1, ...(logo === undefined ? {} : { logo }) },
    estado: { version: 1, secciones: [] },
  },
});
const armar = (logo: unknown, neg: unknown = null) => {
  const adv: string[] = [];
  return { c: contenidoDesdePublicado(resp(logo), negocio(neg), entorno, adv), adv };
};

describe('logo subido en el sitio', () => {
  it('con logo subido: cabecera WebP, icono PNG, imagen al compartir; manda sobre la dirección escrita', () => {
    const { c, adv } = armar(logoOk, manual);
    expect(c.config.logo?.url).toBe(`${MEDIOS}/${P}/l256.webp`);
    expect(c.config.iconoSitio).toBe(`${MEDIOS}/${P}/l64.png`);
    expect(c.config.imagenCompartir).toBe(`${MEDIOS}/${P}/l512.png`);
    expect(adv).toEqual([]);
    expect(iconoDelSitio(c.config.iconoSitio, c.config.logo)).toBe(`${MEDIOS}/${P}/l64.png`);
  });

  it('og:image: el logo solo cuando la página no tiene foto propia', () => {
    const { c } = armar(logoOk);
    expect(imagenAlCompartir(undefined, c.config.imagenCompartir)).toBe(`${MEDIOS}/${P}/l512.png`);
    expect(imagenAlCompartir('https://medios.ejemplo.invalid/foto.webp', c.config.imagenCompartir)).toBe('https://medios.ejemplo.invalid/foto.webp');
  });

  it('solo dirección escrita: se conserva el comportamiento actual', () => {
    const { c } = armar(undefined, manual);
    expect(c.config.logo?.url).toBe(manual.url);
    expect(c.config.iconoSitio).toBeNull();
    expect(c.config.imagenCompartir).toBeNull();
    expect(iconoDelSitio(c.config.iconoSitio, c.config.logo)).toBe(manual.url);
    expect(imagenAlCompartir(undefined, c.config.imagenCompartir)).toBeUndefined();
  });

  it('sin logo de ningún tipo: todo queda como hoy', () => {
    const { c } = armar(undefined);
    expect(c.config.logo).toBeNull();
    expect(iconoDelSitio(c.config.iconoSitio, c.config.logo)).toBeUndefined();
    expect(imagenAlCompartir(undefined, c.config.imagenCompartir)).toBeUndefined();
  });

  it.each([
    ['ruta de otra carpeta', { ancho: 1, alto: 1, versiones: [{ formato: 'webp', lado: 64, ruta: 'tenants/t-ejemplo/privado/x.webp' }] }],
    ['ruta con ..', { ancho: 1, alto: 1, versiones: [{ formato: 'webp', lado: 64, ruta: `${P}/../x.webp` }] }],
    ['sin WebP', { ancho: 1, alto: 1, versiones: [{ formato: 'png', lado: 64, ruta: `${P}/a.png` }] }],
    ['forma inválida', 'texto'],
  ])('logo inválido (%s): se descarta con aviso y no tumba; queda la dirección escrita', (_n, logo) => {
    const { c, adv } = armar(logo, manual);
    expect(c.config.logo?.url).toBe(manual.url);
    expect(c.config.iconoSitio).toBeNull();
    expect(adv).toHaveLength(1);
    expect(adv[0]).toContain('documentos.sitio.logo');
    expect(adv[0]).not.toContain('tenants/');
  });

  it('un host de medios distinto no entra: la base se arma con el host admitido', () => {
    const { c } = armar(logoOk);
    expect(c.config.logo?.url.startsWith(`${MEDIOS}/`)).toBe(true);
  });
});
