import { normalizar } from '../util/buscar.js';

/** Lógica pura de la tabla: filtrar, ordenar y paginar. Sin DOM, sin estado. */

export type Orden = { readonly columna: string; readonly sentido: 'asc' | 'desc' } | null;

export interface Filtro<F> {
  readonly id: string;
  readonly aplica: (fila: F, valor: string) => boolean;
}

/** Filtra por texto (todas las palabras deben aparecer en algún campo, sin tildes ni mayúsculas) y por filtros activos. */
export function filtrar<F>(
  filas: readonly F[],
  texto: string,
  en: ((fila: F) => string[]) | undefined,
  filtros: readonly Filtro<F>[],
  valores: Readonly<Record<string, string>>,
): F[] {
  const palabras = normalizar(texto).split(/\s+/u).filter((p) => p !== '');
  return filas.filter((fila) => {
    for (const f of filtros) {
      const v = valores[f.id] ?? '';
      if (v !== '' && !f.aplica(fila, v)) return false;
    }
    if (palabras.length === 0 || en === undefined) return true;
    const pajar = en(fila).map(normalizar).join(' ');
    return palabras.every((p) => pajar.includes(p));
  });
}

function comparar(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'es', { numeric: true, sensitivity: 'base' });
}

/** Orden estable por el valor de una columna; no modifica la entrada. */
export function ordenar<F>(filas: readonly F[], valor: ((fila: F) => string | number) | undefined, orden: Orden): F[] {
  if (orden === null || valor === undefined) return [...filas];
  const signo = orden.sentido === 'asc' ? 1 : -1;
  return filas
    .map((fila, i) => ({ fila, i }))
    .sort((x, y) => signo * comparar(valor(x.fila), valor(y.fila)) || x.i - y.i)
    .map((x) => x.fila);
}

export interface Pagina<F> {
  readonly filas: F[];
  readonly pagina: number;
  readonly paginas: number;
  readonly desde: number;
  readonly hasta: number;
  readonly total: number;
}

/** Corta una página (base 1); una página fuera de rango se acota. `desde` y `hasta` son posiciones base 1 (0 si no hay filas). */
export function paginar<F>(filas: readonly F[], pagina: number, porPagina: number): Pagina<F> {
  const total = filas.length;
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const p = Math.min(Math.max(1, Math.trunc(pagina) || 1), paginas);
  const inicio = (p - 1) * porPagina;
  const parte = filas.slice(inicio, inicio + porPagina);
  return { filas: parte, pagina: p, paginas, desde: total === 0 ? 0 : inicio + 1, hasta: inicio + parte.length, total };
}
