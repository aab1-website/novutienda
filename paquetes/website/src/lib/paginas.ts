/** Paginación estática del catálogo: 24 productos por página y una página por marca. Puro, sin DOM. */
import { normalizar } from '../contenido/consultas.js';

export const POR_PAGINA = 24;

export const totalPaginas = (n: number, porPagina: number = POR_PAGINA): number => Math.max(1, Math.ceil(n / porPagina));

export interface Pagina<T> {
  readonly items: readonly T[];
  /** Página mostrada, acotada a 1..total. */
  readonly pagina: number;
  readonly total: number;
}

export function paginar<T>(items: readonly T[], pagina: number, porPagina: number = POR_PAGINA): Pagina<T> {
  const total = totalPaginas(items.length, porPagina);
  const actual = Math.min(Math.max(1, Math.trunc(pagina) || 1), total);
  return { items: items.slice((actual - 1) * porPagina, actual * porPagina), pagina: actual, total };
}

/** La página 1 vive en la ruta base; las demás en `<base>/pagina/<n>`. */
export const rutaPagina = (base: string, n: number): string => (n <= 1 ? base : `${base}/pagina/${n}`);

/** Parámetros de `getStaticPaths` para las páginas 2..total de una lista (la 1 es la ruta base). */
export const paginasExtra = (cantidad: number): readonly number[] =>
  Array.from({ length: totalPaginas(cantidad) - 1 }, (_, i) => i + 2);

export interface MarcaConRuta {
  readonly nombre: string;
  readonly slug: string;
}

export const rutaMarca = (slug: string): string => `/marca/${slug}`;

/** Marcas (ya ordenadas) con un slug estable: sin tildes ni signos y, si dos marcas chocan, con sufijo numérico. */
export function marcasConRuta(marcas: readonly string[]): readonly MarcaConRuta[] {
  const usados = new Set<string>();
  return marcas.map((nombre) => {
    const base = normalizar(nombre).replace(/ /g, '-') || 'marca';
    let slug = base;
    for (let i = 2; usados.has(slug); i++) slug = `${base}-${i}`;
    usados.add(slug);
    return { nombre, slug };
  });
}

/** Aviso de los filtros de precio: con varias páginas aclara que el precio filtra solo la página que se está viendo. */
export function avisoDeFiltro(visibles: number, enPagina: number, pagina: number, total: number): string {
  if (total <= 1) return `Mostrando ${visibles} de ${enPagina} productos.`;
  return `Mostrando ${visibles} de ${enPagina} productos de esta página (página ${pagina} de ${total}).`;
}
