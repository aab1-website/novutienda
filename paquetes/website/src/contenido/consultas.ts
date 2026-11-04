/** Consultas puras sobre el contenido: las usan las páginas (build) y las islas (navegador). */
import type { Afirmacion, Categoria, Contenido, Producto, Seccion } from './tipos.js';

export const productoPorSlug = (ps: readonly Producto[], slug: string): Producto | undefined => ps.find((p) => p.slug === slug);

export const productosDeCategoria = (ps: readonly Producto[], categoriaId: string): readonly Producto[] =>
  ps.filter((p) => p.categoria === categoriaId);

export const categoriaPorId = (cs: readonly Categoria[], id: string): Categoria | undefined => cs.find((c) => c.id === id);

/** Secciones editables ordenadas para el menú. */
export const seccionesEnMenu = (ss: readonly Seccion[]): readonly Seccion[] =>
  [...ss].sort((a, b) => a.orden - b.orden || a.titulo.localeCompare(b.titulo, 'es'));

export function marcasDe(ps: readonly Producto[]): readonly string[] {
  return [...new Set(ps.map((p) => p.marca))].sort((a, b) => a.localeCompare(b, 'es'));
}

/** Normaliza para comparar: minúsculas, sin tildes ni signos. */
export function normalizar(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Búsqueda por todas las palabras en nombre, marca o categoría. */
export function buscarProductos<T extends { readonly nombre: string; readonly marca: string; readonly categoria: string }>(
  items: readonly T[], consulta: string, limite = 8,
): readonly T[] {
  const palabras = normalizar(consulta).split(' ').filter((p) => p !== '');
  if (palabras.length === 0) return [];
  return items
    .filter((it) => {
      const pajar = normalizar(`${it.nombre} ${it.marca} ${it.categoria}`);
      return palabras.every((w) => pajar.includes(w));
    })
    .slice(0, limite);
}

export interface FiltroProductos {
  readonly marcas: readonly string[];
  /** Límites en la moneda local del mercado elegido. */
  readonly minimo: number | null;
  readonly maximo: number | null;
}

/**
 * Filtra por marca y por precio. `precioLocal` devuelve el precio final del producto en la
 * moneda del mercado, o null si no tiene precio (consultar) o aún no hay cotización: esos
 * productos solo se muestran mientras no haya un filtro de precio activo.
 */
export function filtrarProductos<T extends { readonly marca: string }>(
  items: readonly T[], filtro: FiltroProductos, precioLocal: (item: T) => number | null,
): readonly T[] {
  const conPrecio = filtro.minimo !== null || filtro.maximo !== null;
  return items.filter((it) => {
    if (filtro.marcas.length > 0 && !filtro.marcas.includes(it.marca)) return false;
    if (!conPrecio) return true;
    const p = precioLocal(it);
    if (p === null) return false;
    return (filtro.minimo === null || p >= filtro.minimo) && (filtro.maximo === null || p <= filtro.maximo);
  });
}

/** Una afirmación sin confirmar no se publica (solo se muestra en una vista previa explícita). */
export const afirmacionVisible = (a: Afirmacion, mostrarPendientes: boolean): boolean => a.confirmada || mostrarPendientes;

export function textoModelos(n: number): string {
  return n === 1 ? '1 modelo disponible' : `${n} modelos disponibles`;
}

/** Textos pendientes de confirmar (no se publican): sirve para avisar en el build qué falta aprobar. */
export function pendientesDeConfirmar(c: Pick<Contenido, 'beneficios' | 'identidad'>): readonly string[] {
  const todos: Afirmacion[] = [...c.beneficios.map((b) => b.titulo), c.identidad.sello, ...(c.identidad.cifra === null ? [] : [c.identidad.cifra.valor])];
  return todos.filter((a) => !a.confirmada).map((a) => a.texto);
}
