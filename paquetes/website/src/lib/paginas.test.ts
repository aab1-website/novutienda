import { describe, expect, it } from 'vitest';
import { avisoDeFiltro, marcasConRuta, paginar, paginasExtra, POR_PAGINA, rutaMarca, rutaPagina, totalPaginas } from './paginas.js';

const lista = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

describe('paginación del catálogo', () => {
  it('24 por página: 24 caben en una, 25 piden dos y 41 piden dos', () => {
    expect(POR_PAGINA).toBe(24);
    expect(totalPaginas(0)).toBe(1);
    expect(totalPaginas(24)).toBe(1);
    expect(totalPaginas(25)).toBe(2);
    expect(totalPaginas(41)).toBe(2);
    expect(totalPaginas(49)).toBe(3);
  });
  it('corta la página y acota los números fuera de rango', () => {
    expect(paginar(lista(41), 1).items).toHaveLength(24);
    const dos = paginar(lista(41), 2);
    expect(dos.items).toEqual(lista(41).slice(24));
    expect(dos.total).toBe(2);
    expect(paginar(lista(41), 9).pagina).toBe(2);
    expect(paginar(lista(41), 0).pagina).toBe(1);
    expect(paginar(lista(41), Number.NaN).pagina).toBe(1);
  });
  it('la página 1 usa la ruta base y las demás /pagina/n', () => {
    expect(rutaPagina('/productos', 1)).toBe('/productos');
    expect(rutaPagina('/productos', 2)).toBe('/productos/pagina/2');
    expect(rutaPagina('/marca/nordika', 3)).toBe('/marca/nordika/pagina/3');
  });
  it('solo se generan las páginas 2..total', () => {
    expect(paginasExtra(24)).toEqual([]);
    expect(paginasExtra(41)).toEqual([2]);
    expect(paginasExtra(49)).toEqual([2, 3]);
  });
  it('cada marca tiene su ruta, sin tildes ni signos y sin choques', () => {
    expect(marcasConRuta(['Aurora', 'Nórdika & Co', 'LG', 'lg']).map((m) => m.slug)).toEqual(['aurora', 'nordika-co', 'lg', 'lg-2']);
    expect(marcasConRuta(['***'])[0]!.slug).toBe('marca');
    expect(rutaMarca('aurora')).toBe('/marca/aurora');
  });
  it('el aviso del filtro de precio dice que solo filtra la página visible cuando hay varias', () => {
    expect(avisoDeFiltro(5, 12, 1, 1)).toBe('Mostrando 5 de 12 productos.');
    expect(avisoDeFiltro(10, 24, 1, 2)).toBe('Mostrando 10 de 24 productos de esta página (página 1 de 2).');
    expect(avisoDeFiltro(17, 17, 2, 2)).toBe('Mostrando 17 de 17 productos de esta página (página 2 de 2).');
  });
});
