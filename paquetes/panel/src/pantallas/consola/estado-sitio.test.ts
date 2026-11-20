import { describe, expect, it } from 'vitest';
import { textoUltimaReconstruccion as t, type UltimaReconstruccionVista as U } from './estado-sitio.js';

const base: U = { estado: 'fallida', version: 3, en: '2026-11-19T10:00:00Z', etapa: 'generar', enCurso: false, causas: [] };

describe('textoUltimaReconstruccion', () => {
  it('sin datos', () => expect(t(null)).toBe('Todavía no se publicó el sitio.'));
  it('sin documento con versión publicada', () => expect(t(null, 4)).toBe('Última publicación: versión 4. El estado del sitio aparecerá tras la próxima actualización.'));
  it('sin documento y versión 0', () => expect(t(undefined, 0)).toBe('Todavía no se publicó el sitio.'));
  it('en curso', () => expect(t({ ...base, enCurso: true })).toBe('Publicando la versión 3: el sitio se actualiza en unos minutos.'));
  it('en curso usa la versión publicada', () => expect(t({ ...base, enCurso: true }, 5)).toBe('Publicando la versión 5: el sitio se actualiza en unos minutos.'));
  it('completada', () => expect(t({ ...base, estado: 'completada', etapa: null })).toBe('El sitio está al día (versión 3).'));
  it('precio fuera de tope', () => expect(t({ ...base, causas: [{ codigo: 'precio_fuera_de_tope', mercado: 'AR', producto: 'Mate' }] }))
    .toBe('La última publicación no llegó al sitio: el producto «Mate» tiene un precio fuera del tope en Argentina.'));
  it('mercado desconocido y sin producto', () => expect(t({ ...base, causas: [{ codigo: 'precio_fuera_de_tope', mercado: 'CL' }] }))
    .toContain('un producto tiene un precio fuera del tope en CL.'));
  it('categoría y demasiadas', () => {
    expect(t({ ...base, causas: [{ codigo: 'categoria_invalida', producto: 'X' }] })).toContain('la categoría del producto «X» no es válida.');
    expect(t({ ...base, causas: [{ codigo: 'demasiadas_categorias' }] })).toContain('hay más de 40 categorías.');
  });
  it('máximo 5 frases y «y N más»', () => {
    const causas = Array.from({ length: 7 }, (_, i) => ({ codigo: 'categoria_invalida', producto: `P${i}` }));
    const s = t({ ...base, causas });
    expect(s).toContain('«P4»');
    expect(s).not.toContain('«P5»');
    expect(s).toMatch(/ y 2 más\.$/);
  });
  it('problema técnico', () => {
    const tec = 'No se pudo actualizar el sitio por un problema técnico. Vuelva a publicar en unos minutos; si sigue igual, avise a NovuTienda.';
    expect(t(base)).toBe(tec);
    expect(t({ ...base, causas: [{ codigo: 'contenido_invalido' }] })).toBe(tec);
    expect(t({ ...base, etapa: 'build', causas: [{ codigo: 'precio_fuera_de_tope', producto: 'X' }] })).toBe(tec);
  });
});
