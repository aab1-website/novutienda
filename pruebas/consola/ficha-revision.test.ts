// El panel revisa la página de un producto con los mismos topes que el servidor. Esta prueba las compara: si cambia una
// regla de `validarFichaWeb` (o la del panel), una de las dos deja de coincidir y la prueba falla.
import { describe, expect, it } from 'vitest';
import { validarFichaWeb } from '@novutienda/consola';
import { revisarFicha, TOPES_FICHA } from '@novutienda/panel/consola';

const base = { slug: 'tv-55', descripcion: 'Televisor.', garantia: '12 meses', medios: [{ medioId: 'medio-0001', alt: 'Frente' }], seo: { titulo: 'Televisor', descripcion: 'Un televisor' }, estado: 'borrador' as const };
const ids = (n: number): { medioId: string; alt: string }[] => Array.from({ length: n }, (_, i) => ({ medioId: `medio-000${String(i)}`, alt: 'a' }));
const x = (n: number): string => 'x'.repeat(n);

const casos: [string, unknown][] = [
  ['válida', base],
  ['slug de 1 letra', { ...base, slug: 'a' }],
  ['slug de 2 letras', { ...base, slug: 'ab' }],
  ['slug de 80', { ...base, slug: x(80) }],
  ['slug de 81', { ...base, slug: x(81) }],
  ['slug con mayúsculas', { ...base, slug: 'Tv' }],
  ['slug con espacio', { ...base, slug: 'mala idea' }],
  ['slug que empieza con guion', { ...base, slug: '-x' }],
  ['slug que termina con guion', { ...base, slug: 'x-' }],
  ['slug con guion doble', { ...base, slug: 'a--b' }],
  ['slug vacío', { ...base, slug: '' }],
  ['descripción de 4000', { ...base, descripcion: x(TOPES_FICHA.descripcion) }],
  ['descripción de 4001', { ...base, descripcion: x(TOPES_FICHA.descripcion + 1) }],
  ['descripción con salto de línea', { ...base, descripcion: 'a\nb\tc' }],
  ['descripción con control', { ...base, descripcion: 'a\u0001b' }],
  ['descripción con HTML', { ...base, descripcion: 'hola <script>alert(1)</script>' }],
  ['descripción con signo menor', { ...base, descripcion: 'Pesa <5 kg' }],
  ['garantía de 300', { ...base, garantia: x(300) }],
  ['garantía de 301', { ...base, garantia: x(301) }],
  ['garantía con salto de línea', { ...base, garantia: 'a\nb' }],
  ['título de 70', { ...base, seo: { ...base.seo, titulo: x(70) } }],
  ['título de 71', { ...base, seo: { ...base.seo, titulo: x(71) } }],
  ['descripción SEO de 160', { ...base, seo: { ...base.seo, descripcion: x(160) } }],
  ['descripción SEO de 161', { ...base, seo: { ...base.seo, descripcion: x(161) } }],
  ['descripción SEO con HTML', { ...base, seo: { ...base.seo, descripcion: '<b>x</b>' } }],
  ['publicado sin descripción', { ...base, estado: 'publicado', descripcion: '' }],
  ['publicado con descripción', { ...base, estado: 'publicado' }],
  ['oculto sin descripción', { ...base, estado: 'oculto', descripcion: '' }],
  ['sin medios', { ...base, medios: [] }],
  ['6 medios', { ...base, medios: ids(6) }],
  ['7 medios', { ...base, medios: ids(7) }],
  ['medio repetido', { ...base, medios: [{ medioId: 'medio-0001', alt: 'a' }, { medioId: 'medio-0001', alt: 'b' }] }],
  ['descripción de medio vacía', { ...base, medios: [{ medioId: 'medio-0001', alt: '' }] }],
  ['descripción de medio de 160', { ...base, medios: [{ medioId: 'medio-0001', alt: x(160) }] }],
  ['descripción de medio de 161', { ...base, medios: [{ medioId: 'medio-0001', alt: x(161) }] }],
  ['descripción de medio con HTML', { ...base, medios: [{ medioId: 'medio-0001', alt: '<img src=x>' }] }],
];

describe('revisarFicha coincide con validarFichaWeb', () => {
  it.each(casos)('%s', (_nombre, ficha) => {
    const panel = Object.keys(revisarFicha(ficha as never)).length === 0;
    expect(panel).toBe(validarFichaWeb(ficha).ok);
  });
  it('coincide también con combinaciones al azar de valores límite', () => {
    let semilla = 12345;
    const azar = (n: number): number => {
      semilla = (semilla * 1103515245 + 12345) % 2147483648;
      return semilla % n;
    };
    const elegir = <T,>(l: readonly T[]): T => l[azar(l.length)] as T;
    for (let i = 0; i < 400; i++) {
      const ficha = {
        slug: elegir(['tv', 'a', '', x(80), x(81), 'A-b', 'a--b', 'ok-1']),
        descripcion: elegir(['', 'Texto', x(4000), x(4001), '<i>x</i>', 'a<b']),
        garantia: elegir(['', x(300), x(301)]),
        medios: elegir([[], ids(1), ids(6), ids(7), [{ medioId: 'medio-0001', alt: '' }], [{ medioId: 'medio-0001', alt: 'a' }, { medioId: 'medio-0001', alt: 'a' }]]),
        seo: { titulo: elegir(['', x(70), x(71)]), descripcion: elegir(['', x(160), x(161)]) },
        estado: elegir(['borrador', 'publicado', 'oculto'] as const),
      };
      expect(Object.keys(revisarFicha(ficha as never)).length === 0, JSON.stringify(ficha).slice(0, 200)).toBe(validarFichaWeb(ficha).ok);
    }
  });
});
