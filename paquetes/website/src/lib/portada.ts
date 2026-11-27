/** Lógica pura de la portada: qué tarjetas se escriben en el HTML y cuáles se ven según el chip elegido. Sin DOM. */

/** Tarjetas que se ven a la vez en la portada (en «Todos» y en cada categoría); el resto se consulta en el catálogo. */
export const TOPE_PORTADA = 12;

export interface ItemPortada {
  readonly id: string;
  readonly categoria: string;
}

/** Los que se ven: las primeras `tope` tarjetas, de todo el surtido o de la categoría elegida (`null` = «Todos»), en el orden recibido. */
export function visiblesPortada(items: readonly ItemPortada[], categoria: string | null, tope: number = TOPE_PORTADA): ReadonlySet<string> {
  const lista = categoria === null ? items : items.filter((i) => i.categoria === categoria);
  return new Set(lista.slice(0, tope).map((i) => i.id));
}

/** Cuántos productos tiene la selección completa (no solo los que se ven). */
export const totalPortada = (items: readonly ItemPortada[], categoria: string | null): number =>
  categoria === null ? items.length : items.filter((i) => i.categoria === categoria).length;

/**
 * Los que se escriben en el HTML: la unión de lo que se ve en «Todos» y en cada categoría, en el orden recibido. Así tocar un chip
 * filtra sin pedir nada, y la página pesa a lo sumo `tope` tarjetas por categoría y no el catálogo entero.
 */
export function escribirPortada<T extends ItemPortada>(items: readonly T[], tope: number = TOPE_PORTADA): readonly T[] {
  const ids = new Set(visiblesPortada(items, null, tope));
  for (const c of new Set(items.map((i) => i.categoria))) for (const id of visiblesPortada(items, c, tope)) ids.add(id);
  return items.filter((i) => ids.has(i.id));
}
