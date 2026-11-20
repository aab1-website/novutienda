import { describe, expect, it } from 'vitest';
import {
  esEtapaFallaSitio,
  esIdProductoSitio,
  esMercadoSitio,
  leerCausasFallaSitio,
  MAX_CAUSAS_SITIO,
} from './causas-sitio.js';

describe('leerCausasFallaSitio', () => {
  it('acepta causas válidas', () => {
    const e = [
      { codigo: 'precio_fuera_de_tope', productoId: 'lavajilla-1', mercado: 'AR' },
      { codigo: 'demasiadas_categorias' },
    ];
    expect(leerCausasFallaSitio(e)).toEqual(e);
  });
  it('descarta código desconocido', () => {
    expect(leerCausasFallaSitio([{ codigo: 'otro' }])).toEqual([]);
  });
  it('descarta id con mayúsculas, vacío o demasiado largo', () => {
    const c = 'contenido_invalido';
    expect(leerCausasFallaSitio([{ codigo: c, productoId: 'Abc' }])).toEqual([]);
    expect(leerCausasFallaSitio([{ codigo: c, productoId: '' }])).toEqual([]);
    expect(leerCausasFallaSitio([{ codigo: c, productoId: '-a' }])).toEqual([]);
    expect(leerCausasFallaSitio([{ codigo: c, productoId: 'a'.repeat(81) }])).toEqual([]);
    expect(esIdProductoSitio('a'.repeat(80))).toBe(true);
  });
  it('descarta mercado mal formado', () => {
    const c = 'precio_fuera_de_tope';
    expect(leerCausasFallaSitio([{ codigo: c, mercado: 'ar' }])).toEqual([]);
    expect(leerCausasFallaSitio([{ codigo: c, mercado: 'ARG' }])).toEqual([]);
    expect(esMercadoSitio('BO')).toBe(true);
  });
  it('limita a 20 causas', () => {
    const e = Array.from({ length: 30 }, () => ({ codigo: 'contenido_invalido' }));
    expect(leerCausasFallaSitio(e)).toHaveLength(MAX_CAUSAS_SITIO);
  });
  it('descarta campos de más', () => {
    expect(
      leerCausasFallaSitio([{ codigo: 'contenido_invalido', detalle: 'x' }]),
    ).toEqual([]);
  });
  it('lo que no es lista o elemento da vacío', () => {
    expect(leerCausasFallaSitio(null)).toEqual([]);
    expect(leerCausasFallaSitio('x')).toEqual([]);
    expect(leerCausasFallaSitio([null, 3, [], 'x'])).toEqual([]);
  });
});

describe('etapas', () => {
  it('reconoce solo las declaradas', () => {
    expect(esEtapaFallaSitio('humo')).toBe(true);
    expect(esEtapaFallaSitio('otra')).toBe(false);
    expect(esEtapaFallaSitio(1)).toBe(false);
  });
});
