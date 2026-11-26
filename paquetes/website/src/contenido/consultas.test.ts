import { describe, expect, it } from 'vitest';
import { paginar } from '../lib/paginas.js';
import { categoriasConVenta, productosEnOrdenDeCategorias, afirmacionVisible, institucionalVisible, buscarProductos, categoriaPorId, filtrarProductos, marcasDe, pendientesDeConfirmar, normalizar, productoPorSlug, productosDeCategoria, seccionesEnMenu, textoModelos } from './consultas.js';
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
    expect([...pendientesDeConfirmar(c)].sort()).toEqual(pendientes.map((a) => a.texto).sort());
  });

  it('categoría sin productos a la venta (sin productos o todos agotados) no es navegable', () => {
    const [a, b] = c.categorias;
    const vacia = { id: 'vacia', nombre: 'Vacía', icono: a!.icono };
    const ps = c.productos.filter((p) => p.categoria === a!.id || p.categoria === b!.id).map((p) => (p.categoria === b!.id ? { ...p, disponible: false } : p));
    expect(categoriasConVenta([a!, b!, vacia], ps).map((x) => x.id)).toEqual([a!.id]);
  });

  it('categoría desconocida va al final y el orden es estable dentro de cada categoría', () => {
    const [a, b] = c.categorias;
    const base = c.productos.find((p) => p.categoria === a!.id)!;
    const mk = (id: string, categoria: string) => ({ ...base, id, categoria });
    const ps = [mk('x1', 'rara'), mk('b1', b!.id), mk('a1', a!.id), mk('x2', 'otra'), mk('a2', a!.id), mk('b2', b!.id)];
    expect(productosEnOrdenDeCategorias(ps, [b!, a!]).map((p) => p.id)).toEqual(['b1', 'b2', 'a1', 'a2', 'x1', 'x2']);
  });

  it('las páginas 1 y 2 del listado parten el mismo orden del catálogo, sin repetir ni omitir', () => {
    const base = c.productos[0]!;
    const cats = c.categorias;
    const ps = Array.from({ length: 30 }, (_, i) => ({ ...base, id: `p${i}`, categoria: cats[i % cats.length]!.id }));
    const catalogo = productosEnOrdenDeCategorias(ps, cats);
    const p1 = paginar(catalogo, 1).items.map((p) => p.id);
    const p2 = paginar(catalogo, 2).items.map((p) => p.id);
    expect([...p1, ...p2]).toEqual(catalogo.map((p) => p.id));
    expect(new Set([...p1, ...p2]).size).toBe(30);
  });
});

describe('institucionalVisible', () => {
  it('sin nada o vacío no hay sección', () => {
    expect(institucionalVisible(undefined).hay).toBe(false);
    expect(institucionalVisible({}).hay).toBe(false);
    expect(institucionalVisible({ mision: '  ' }).hay).toBe(false);
  });
  it('la cifra sin confirmar figura entre los pendientes de confirmar', () => {
    const c2 = { beneficios: [], identidad: { ...c.identidad, sello: { texto: 's', confirmada: true }, cifra: { valor: { texto: '+5,000', confirmada: false }, detalle: 'clientes' } } };
    expect(pendientesDeConfirmar(c2)).toEqual(['+5,000']);
  });
  it('misión, visión y chat con contenido se muestran', () => {
    const v = institucionalVisible({ mision: 'm', vision: 'v', chat: { mensajes: [{ de: 'cliente', texto: 'hola' }] } });
    expect(v).toMatchObject({ mision: 'm', vision: 'v', hay: true });
    expect(v.chat).toHaveLength(1);
  });
});
