import { describe, expect, it } from 'vitest';
import type { FichaWeb } from '../../api/tipos.js';
import { claveAlt, revisarFicha, TOPES_FICHA } from './ficha-revision.js';

const ok: FichaWeb = { slug: 'tv-55', descripcion: 'Televisor.', garantia: '12 meses', medios: [{ medioId: 'medio-0001', alt: 'Frente' }], seo: { titulo: 'Televisor', descripcion: 'Un televisor' }, estado: 'borrador' };

describe('revisarFicha', () => {
  it('una ficha válida no tiene errores', () => {
    expect(revisarFicha(ok)).toEqual({});
  });
  it('marca cada campo con su propio mensaje', () => {
    const e = revisarFicha({ ...ok, slug: 'Mala Idea', garantia: 'x'.repeat(TOPES_FICHA.garantia + 1), descripcion: 'hola <b>x</b>', seo: { titulo: 'x'.repeat(71), descripcion: 'x'.repeat(161) }, medios: [{ medioId: 'medio-0001', alt: '' }] });
    expect(Object.keys(e).sort()).toEqual(['descripcion', 'garantia', 'medios.0.alt', 'seo.descripcion', 'seo.titulo', 'slug']);
    expect(e['medios.0.alt']).toBe(revisarFicha({ ...ok, medios: [{ medioId: 'medio-0001', alt: '' }] })[claveAlt(0)]);
  });
  it('publicar exige descripción; un signo menor suelto no es HTML', () => {
    expect(revisarFicha({ ...ok, estado: 'publicado', descripcion: '' })['descripcion']).toMatch(/Para publicar/);
    expect(revisarFicha({ ...ok, descripcion: 'Pesa <5 kg' })).toEqual({});
  });
  it('rechaza más de 6 medios y medios repetidos', () => {
    const siete = Array.from({ length: 7 }, (_, i) => ({ medioId: `medio-000${String(i)}`, alt: 'a' }));
    expect(revisarFicha({ ...ok, medios: siete })['medios']).toBeTruthy();
    expect(revisarFicha({ ...ok, medios: [{ medioId: 'medio-0001', alt: 'a' }, { medioId: 'medio-0001', alt: 'b' }] })['medios']).toBeTruthy();
  });
  it('los mensajes no muestran nombres internos ni códigos', () => {
    const e = revisarFicha({ ...ok, slug: '', garantia: 'x'.repeat(400), medios: [{ medioId: 'medio-0001', alt: '' }] });
    for (const m of Object.values(e)) expect(m).not.toMatch(/\[\d{3}\]|seo\.|medios\[|undefined|null/);
  });
});
