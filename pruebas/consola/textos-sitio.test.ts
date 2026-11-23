// «Textos del sitio» del panel: sus topes coinciden con los del servidor y lo que arma es lo que el servidor acepta.
import { describe, expect, it } from 'vitest';
import { LIMITES_TEXTOS_SITIO } from '@novutienda/nucleo';
import { urlMapaSegura, validarNegocioSitio } from '@novutienda/consola/negocio';
import { aEstado, aNegocio, mapaValido, revisarTextos, TOPES_TEXTOS } from '@novutienda/panel/consola';

const negocio = {
  nombre: 'Tienda Ejemplo', lema: 'Lema', telefono: '22223333', correo: 'hola@ejemplo.test', direccion: 'Calle 1', horario: null,
  enlacesPermitidos: [],
  portada: { insignia: 'Nuevo', titulo: ['Uno', 'Dos', 'Tres'], texto: 'Texto', textoBotonCatalogo: 'Ver', textoBotonConsulta: 'Consultar' },
  beneficios: [],
  identidad: { etiqueta: 'N', titulo: 'T', texto: 'X', foto: null, cifra: null, valores: [], sello: { texto: 'S', confirmada: false } },
  textoPrivacidad: ['P'], categorias: {}, destacados: [],
};
const MAPAS_VALIDOS = ['https://www.google.com/maps/place/Tienda+Ejemplo/@-17.39,-66.15,17z', 'https://www.google.com/maps?q=-17.39,-66.15', 'https://maps.google.com/?q=tienda', 'https://maps.app.goo.gl/AbC123', 'https://goo.gl/maps/AbC123'];
const MAPAS_INVALIDOS = [
  'javascript:alert(1)', 'http://www.google.com/maps', 'https://www.google.com/search?q=maps', 'https://www.google.com/mapsx', 'https://goo.gl/otra',
  'https://google.com/maps', 'https://evil.com/maps', 'https://www.google.com.evil.com/maps', 'https://usuario@www.google.com/maps',
  'https://www.google.com:8443/maps', 'https://maps.google.com/ruta con espacio', `https://maps.app.goo.gl/${'a'.repeat(1000)}`, '', 'data:text/html,x',
  'https://www.google.com/maps/../url?q=https://evil.com', 'https://www.google.com/maps/%2e%2e/url?q=x', 'https://goo.gl/maps/../abc', 'https://MAPS.GOOGLE.COM/x', 'https://maps.google.com:443/x', 'https://maps.google.com:/x', 'https:///maps.google.com/x', 'https:/maps.google.com/x', 'https://maps.google.com\\@evil.com/x', 'https://maps.google%2ecom/x', 'https://maps.google.\uff43om/x', 'https://www.google.com/maps/%2E%2E/url', 'https://www.google.com/maps/./x', 'https://www.google.com/maps/..',
];
const vacio = aEstado(null);
const valido = (n: unknown): boolean => { try { validarNegocioSitio(n, { nivel: 'estricto' }); return true; } catch { return false; } };

describe('textos del sitio', () => {
  it('los topes son los del servidor', () => {
    expect(TOPES_TEXTOS.texto).toBe(LIMITES_TEXTOS_SITIO.texto);
    expect(TOPES_TEXTOS.mensajes).toBe(LIMITES_TEXTOS_SITIO.mensajes);
    expect(TOPES_TEXTOS.mensaje).toBe(LIMITES_TEXTOS_SITIO.mensaje);
    expect(TOPES_TEXTOS.cifraValor).toBe(LIMITES_TEXTOS_SITIO.cifraValor);
    expect(TOPES_TEXTOS.cifraDetalle).toBe(LIMITES_TEXTOS_SITIO.cifraDetalle);
  });
  it('todo vacío no agrega nada: sin institucional y cifra nula', () => {
    const n = aNegocio(negocio, vacio);
    expect('institucional' in n).toBe(false);
    expect((n['identidad'] as { cifra: unknown }).cifra).toBeNull();
    expect(valido(n)).toBe(true);
  });
  it('lo completo lo acepta el servidor y vuelve igual al leerlo', () => {
    const e = { ...vacio, mision: ' Misión ', vision: 'Visión', cifraValor: 'Más de 500 clientes', cifraDetalle: 'desde 2015', cifraConfirmada: true,
      mensajes: [{ de: 'cliente' as const, texto: 'Hola' }, { de: 'comercio' as const, texto: 'Buenas' }, { de: 'cliente' as const, texto: '   ' }] };
    expect(Object.keys(revisarTextos(e))).toEqual([]);
    const n = aNegocio(negocio, e);
    expect(valido(n)).toBe(true);
    const de = aEstado(n);
    expect(de.mision).toBe('Misión');
    expect(de.mensajes).toEqual([{ de: 'cliente', texto: 'Hola' }, { de: 'comercio', texto: 'Buenas' }]);
    expect(de.cifraConfirmada).toBe(true);
  });
  it('los errores del panel son los que el servidor rechazaría', () => {
    const casos = [
      { ...vacio, mision: 'a'.repeat(601) },
      { ...vacio, cifraValor: 'Más de 500' },
      { ...vacio, cifraDetalle: 'solo detalle' },
      { ...vacio, mensajes: Array.from({ length: 7 }, () => ({ de: 'cliente' as const, texto: 'x' })) },
      { ...vacio, mensajes: [{ de: 'cliente' as const, texto: 'a'.repeat(301) }] },
    ];
    for (const e of casos) {
      expect(Object.keys(revisarTextos(e)).length > 0, JSON.stringify(e).slice(0, 60)).toBe(!valido(aNegocio(negocio, e)));
    }
  });
  it('el enlace del mapa: vacío no agrega la clave; con valor la copia del panel y la del servidor deciden igual', () => {
    expect('mapa' in aNegocio(negocio, vacio)).toBe(false);
    expect('mapa' in aNegocio({ ...negocio, mapa: 'https://maps.app.goo.gl/x' }, vacio)).toBe(false);
    expect(aEstado({ ...negocio, mapa: 'https://maps.app.goo.gl/x' }).mapa).toBe('https://maps.app.goo.gl/x');
    const lleno = aNegocio(negocio, { ...vacio, mapa: ' https://maps.app.goo.gl/AbC123 ' });
    expect(lleno['mapa']).toBe('https://maps.app.goo.gl/AbC123');
    expect(valido(lleno)).toBe(true);
    for (const u of [...MAPAS_VALIDOS, ...MAPAS_INVALIDOS]) {
      expect(mapaValido(u), u).toBe(urlMapaSegura(u));
      if (u !== '') expect(Object.keys(revisarTextos({ ...vacio, mapa: u })).includes('mapa'), u).toBe(!urlMapaSegura(u));
    }
  });
});
