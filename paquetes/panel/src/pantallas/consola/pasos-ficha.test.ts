import { describe, expect, it } from 'vitest';
import type { FichaWeb } from '../../api/tipos.js';
import { cumpleFiltro, pasosDeFicha, siguientePaso, textoCambiosSinPublicar, textoQueFalta } from './pasos-ficha.js';

const ficha = (c: Partial<FichaWeb> = {}): FichaWeb => ({ slug: 'tv', descripcion: '', garantia: '', medios: [], seo: { titulo: '', descripcion: '' }, estado: 'borrador', ...c });

describe('pasos de la ficha', () => {
  it('sin página, falta todo y el siguiente paso es crearla', () => {
    expect(pasosDeFicha(undefined).every((p) => !p.hecho)).toBe(true);
    expect(siguientePaso(undefined)).toMatchObject({ id: 'pagina', accion: 'Preparar para el sitio', modo: 'datos' });
    expect(textoQueFalta(undefined)).toBe('Aún no está en el sitio');
  });
  it('con página vacía, el siguiente paso es la descripción', () => {
    expect(siguientePaso(ficha())).toMatchObject({ id: 'descripcion', modo: 'datos' });
    expect(textoQueFalta(ficha())).toBe('Falta: descripción, foto, elegir «Visible en el sitio»');
  });
  it('con descripción y sin fotos, el siguiente paso abre las fotos', () => {
    expect(siguientePaso(ficha({ descripcion: 'Texto' }))).toMatchObject({ id: 'fotos', accion: 'Subir fotos', modo: 'medios' });
  });
  it('una descripción de solo espacios no cuenta', () => {
    expect(siguientePaso(ficha({ descripcion: '   ' }))?.id).toBe('descripcion');
  });
  it('con fotos y en borrador u oculta, falta elegir «Visible en el sitio»', () => {
    const f = ficha({ descripcion: 'Texto', medios: [{ medioId: 'm1', alt: 'x' }] });
    expect(siguientePaso(f)).toMatchObject({ id: 'visible', accion: 'Mostrar en el sitio' });
    expect(siguientePaso({ ...f, estado: 'oculto' })?.id).toBe('visible');
  });
  it('completa: sin siguiente paso y sin afirmar que ya salió en el sitio', () => {
    const f = ficha({ descripcion: 'Texto', medios: [{ medioId: 'm1', alt: 'x' }], estado: 'publicado' });
    expect(siguientePaso(f)).toBeNull();
    expect(textoQueFalta(f)).toBe('Completa');
    expect(textoQueFalta(f)).not.toMatch(/sitio\b.*salió|ya sali/i);
  });
  it('filtros de la lista', () => {
    expect(cumpleFiltro(undefined, 'sin-pagina')).toBe(true);
    expect(cumpleFiltro(ficha(), 'sin-pagina')).toBe(false);
    expect(cumpleFiltro(ficha(), 'borrador')).toBe(true);
    expect(cumpleFiltro(ficha({ estado: 'publicado' }), 'borrador')).toBe(false);
    expect(cumpleFiltro(ficha(), 'sin-fotos')).toBe(true);
    expect(cumpleFiltro(ficha({ medios: [{ medioId: 'm', alt: 'a' }] }), 'sin-fotos')).toBe(false);
  });
  it('plural de los cambios sin publicar', () => {
    expect(textoCambiosSinPublicar(1)).toBe('1 cambio sin publicar');
    expect(textoCambiosSinPublicar(3)).toBe('3 cambios sin publicar');
  });
});
