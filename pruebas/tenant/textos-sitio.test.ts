import { describe, expect, it } from 'vitest';
import { LIMITES_TEXTOS_SITIO as L, validarCaracteristicas, validarCifra, validarInstitucional } from '@novutienda/nucleo/extension';
import * as raiz from '@novutienda/nucleo';
import * as ext from '@novutienda/nucleo/extension';

const t = (n: number): string => 'a'.repeat(n);

describe('textos del sitio: límites únicos', () => {
  it('fija los límites del contrato', () => {
    expect(L).toEqual({ texto: 600, mensajes: 6, mensaje: 300, caracteristicas: 8, caracteristica: 160, cifraValor: 20, cifraDetalle: 120, bloquesNosotros: 6, tituloBloque: 80, parrafosBloque: 6, parrafoBloque: 1000 });
  });
  it('misión y visión: de 1 a 600', () => {
    expect(validarInstitucional({ mision: t(600), vision: t(1) }, 'i')).toEqual([]);
    expect(validarInstitucional({ mision: '' }, 'i')).toHaveLength(1);
    expect(validarInstitucional({ vision: t(601) }, 'i')).toHaveLength(1);
    expect(validarInstitucional(undefined, 'i')).toEqual([]);
  });
  it('chat: de 1 a 6 mensajes de 1 a 300 con autor válido', () => {
    const m = (de: string, n: number) => ({ de, texto: t(n) });
    expect(validarInstitucional({ chat: { mensajes: Array.from({ length: 6 }, () => m('cliente', 300)) } }, 'i')).toEqual([]);
    expect(validarInstitucional({ chat: { mensajes: [] } }, 'i')).toHaveLength(1);
    expect(validarInstitucional({ chat: { mensajes: Array.from({ length: 7 }, () => m('comercio', 1)) } }, 'i')).toHaveLength(1);
    expect(validarInstitucional({ chat: { mensajes: [m('otro', 301)] } }, 'i')).toHaveLength(2);
  });
  it('características: de 1 a 8 viñetas de 1 a 160', () => {
    expect(validarCaracteristicas(undefined, 'c')).toEqual([]);
    expect(validarCaracteristicas(Array.from({ length: 8 }, () => t(160)), 'c')).toEqual([]);
    expect(validarCaracteristicas([], 'c')).toHaveLength(1);
    expect(validarCaracteristicas(Array.from({ length: 9 }, () => 'x'), 'c')).toHaveLength(1);
    expect(validarCaracteristicas([t(161)], 'c')).toHaveLength(1);
  });
  it('cifra: valor.texto de 1 a 20 y detalle de 1 a 120; null es sin cifra', () => {
    expect(validarCifra(null, 'x')).toEqual([]);
    expect(validarCifra({ valor: { texto: t(20), confirmada: true }, detalle: t(120) }, 'x')).toEqual([]);
    expect(validarCifra({ valor: { texto: t(21) }, detalle: '' }, 'x')).toHaveLength(2);
  });
  it('rechaza textos en blanco', () => {
    expect(validarInstitucional({ mision: '   ' }, 'i')).toHaveLength(1);
    expect(validarInstitucional({ vision: '\n ' }, 'i')).toHaveLength(1);
    expect(validarInstitucional({ chat: { mensajes: [{ de: 'cliente', texto: '  ' }] } }, 'i')).toHaveLength(1);
    expect(validarCaracteristicas(['   '], 'c')).toHaveLength(1);
    expect(validarCifra({ valor: { texto: '  ' }, detalle: ' ' }, 'x')).toHaveLength(2);
  });
  it('nosotros: bloques con título y párrafos, límites exactos', () => {
    const b = (titulo = 'Título', parrafos: unknown[] = ['Texto']) => ({ titulo, parrafos });
    const v = (nosotros: unknown) => validarInstitucional({ nosotros }, 'i');
    expect(validarInstitucional({}, 'i')).toEqual([]);
    expect(v(Array.from({ length: 6 }, () => b()))).toEqual([]);
    expect(v(Array.from({ length: 7 }, () => b()))).toHaveLength(1);
    expect(v([])).toHaveLength(1);
    expect(v([b(t(80))])).toEqual([]);
    expect(v([b(t(81))])).toHaveLength(1);
    expect(v([b('')])).toHaveLength(1);
    expect(v([b('Título', Array.from({ length: 6 }, () => 'x'))])).toEqual([]);
    expect(v([b('Título', Array.from({ length: 7 }, () => 'x'))])).toHaveLength(1);
    expect(v([b('Título', [])])).toHaveLength(1);
    expect(v([b('Título', [t(1000)])])).toEqual([]);
    expect(v([b('Título', [t(1001)])])).toHaveLength(1);
    expect(v([b('Título', [''])])).toHaveLength(1);
    expect(v([b('<b>Hola</b>')])).toHaveLength(1);
    expect(v([b('Título', ['Hola <script>x</script>'])])).toHaveLength(1);
    expect(v([b('Título', ['línea uno\nlínea dos'])])).toHaveLength(1);
    expect(v([b('Título', ['con\u0007control'])])).toHaveLength(1);
    expect(v('texto')).toHaveLength(1);
  });
  it('la raíz y /extension exponen lo mismo', () => {
    expect(raiz.LIMITES_TEXTOS_SITIO).toBe(ext.LIMITES_TEXTOS_SITIO);
    expect(raiz.validarCifra).toBe(ext.validarCifra);
    expect(raiz.validarInstitucional).toBe(ext.validarInstitucional);
  });
});
