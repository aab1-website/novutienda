// «Textos del sitio» del panel: sus topes coinciden con los del servidor y lo que arma es lo que el servidor acepta.
import { describe, expect, it } from 'vitest';
import { LIMITES_TEXTOS_SITIO } from '@novutienda/nucleo';
import { validarNegocioSitio } from '@novutienda/consola/negocio';
import { aEstado, aNegocio, revisarTextos, TOPES_TEXTOS } from '@novutienda/panel/consola';

const negocio = {
  nombre: 'Tienda Ejemplo', lema: 'Lema', telefono: '22223333', correo: 'hola@ejemplo.test', direccion: 'Calle 1', horario: null,
  enlacesPermitidos: [],
  portada: { insignia: 'Nuevo', titulo: ['Uno', 'Dos', 'Tres'], texto: 'Texto', textoBotonCatalogo: 'Ver', textoBotonConsulta: 'Consultar' },
  beneficios: [],
  identidad: { etiqueta: 'N', titulo: 'T', texto: 'X', foto: null, cifra: null, valores: [], sello: { texto: 'S', confirmada: false } },
  textoPrivacidad: ['P'], categorias: {}, destacados: [],
};
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
});
