import type { ConteoAbierto, ListaConMarca, MarcaOcultamiento } from './tipos.js';

/**
 * Ayudas puras para la marca de ocultamiento que viaja como propiedad de la lista (`existenciasOcultas`, `conteosAbiertos`).
 * Las propiedades son no enumerables y de solo lectura: no salen en `JSON.stringify` ni en `Object.keys`, y no alteran las
 * comparaciones de listas. `filter`, `map` y el spread producen listas sin marca; quien transforme una lista la reaplica con
 * `conMarca`.
 */

/** Pone la marca en la lista (no enumerable, solo lectura) y la devuelve. Con `undefined` no toca la lista. */
export function ponerMarca<T>(lista: T[], marca: MarcaOcultamiento | undefined): ListaConMarca<T> {
  if (marca === undefined) return lista;
  Object.defineProperties(lista, {
    existenciasOcultas: { value: true, enumerable: false, writable: false, configurable: false },
    conteosAbiertos: { value: marca.conteosAbiertos, enumerable: false, writable: false, configurable: false },
  });
  return lista;
}

/** La marca de una lista, o `undefined` si no la trae. Falla cerrado: oculta es solo `existenciasOcultas === true`. */
export function marcaDe(lista: ListaConMarca<unknown> | null | undefined): MarcaOcultamiento | undefined {
  if (lista?.existenciasOcultas !== true) return undefined;
  const conteos: readonly ConteoAbierto[] = Array.isArray(lista.conteosAbiertos) ? lista.conteosAbiertos : [];
  return { existenciasOcultas: true, conteosAbiertos: conteos };
}

/** Copia a `listaNueva` la marca de `listaOrigen` (la lista nueva sale de filtrar o mapear la de origen). */
export function conMarca<T>(listaNueva: T[], listaOrigen: ListaConMarca<unknown> | null | undefined): ListaConMarca<T> {
  return ponerMarca(listaNueva, marcaDe(listaOrigen));
}
