import { describe, expect, it } from 'vitest';
import { afirmacionVisible, buscarProductos, categoriaPorId, filtrarProductos, marcasDe, normalizar, productoPorSlug, productosDeCategoria, seccionesEnMenu, textoModelos } from './consultas.js';
import { contenidoEjemplo as c } from './ejemplo.js';

describe('consultas de contenido', () => {
  it('busca por slug, categoría y marca', () => {
    expect(productoPorSlug(c.productos, 'televisor-ejemplo-55')?.id).toBe('ejemplo-tv-55');
    expect(productoPorSlug(c.productos, 'no-existe')).toBeUndefined();
    expect(productosDeCategoria(c.productos, 'lavadoras')).toHaveLength(2);
    expect(categoriaPorId(c.categorias, 'aires')?.nombre).toContain('Aires');
    expect(marcasDe(c.productos)).toEqual(['Aurora', 'Lumina', 'Nórdika', 'Vektor']);
  });

  it('normaliza tildes y mayúsculas', () => {
    expect(normalizar('  Nórdika   LAVADORA! ')).toBe('nordika lavadora');
  });

  it('el buscador exige todas las palabras y respeta el límite', () => {
    expect(buscarProductos(c.productos, 'nordika lavadora').map((p) => p.id)).toEqual(['ejemplo-lavadora-9']);
    expect(buscarProductos(c.productos, 'LAVADORA')).toHaveLength(2);
    expect(buscarProductos(c.productos, '   ')).toEqual([]);
    expect(buscarProductos(c.productos, 'ejemplo', 3)).toHaveLength(3);
  });

  it('filtra por marca y por precio; sin precio solo aparece sin filtro de precio', () => {
    const precio = (p: { id: string }): number | null => (p.id === 'ejemplo-tv-65' ? null : 100 * c.productos.findIndex((x) => x.id === p.id));
    const tv = productosDeCategoria(c.productos, 'televisores');
    expect(filtrarProductos(tv, { marcas: [], minimo: null, maximo: null }, precio)).toHaveLength(3);
    expect(filtrarProductos(tv, { marcas: ['Aurora'], minimo: null, maximo: null }, precio)).toHaveLength(2);
    expect(filtrarProductos(tv, { marcas: [], minimo: 50, maximo: null }, precio).map((p) => p.id)).toEqual(['ejemplo-tv-43']);
    expect(filtrarProductos(tv, { marcas: [], minimo: null, maximo: 50 }, precio).map((p) => p.id)).toEqual(['ejemplo-tv-55']);
  });

  it('ordena las secciones del menú y aplica la regla de afirmaciones sin confirmar', () => {
    const orden = seccionesEnMenu([{ ...c.secciones[1]!, orden: 1 }, { ...c.secciones[0]!, orden: 5 }]);
    expect(orden.map((s) => s.orden)).toEqual([1, 5]);
    expect(afirmacionVisible({ texto: 'x', confirmada: false }, false)).toBe(false);
    expect(afirmacionVisible({ texto: 'x', confirmada: false }, true)).toBe(true);
    expect(afirmacionVisible({ texto: 'x', confirmada: true }, false)).toBe(true);
    expect(textoModelos(1)).toBe('1 modelo disponible');
    expect(textoModelos(3)).toBe('3 modelos disponibles');
  });

  it('el ejemplo deja SIN confirmar las afirmaciones de clientes y de originalidad', () => {
    const pendientes = [...c.beneficios.map((b) => b.titulo), c.identidad.cifra!.valor, c.identidad.sello].filter((a) => !a.confirmada);
    expect(pendientes.length).toBeGreaterThanOrEqual(3);
  });
});
