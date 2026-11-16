/**
 * Clave interna automática de un producto nuevo. Copia idéntica de `identificadorParaAlta` de `@novutienda/inventarios`
 * (mismos vectores de prueba en ambos lados): el nombre sin tildes ni signos («Cable HDMI 2 m» → «cable-hdmi-2-m»); si queda con
 * menos de 2 caracteres, el SKU en minúsculas; si tampoco alcanza, «producto». Si ya está en `ocupados`, agrega -2…-999.
 * La persona nunca la ve ni la escribe.
 */
const limpiar = (t: string): string =>
  t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56).replace(/-+$/, '');

export function identificadorParaAlta(nombre: string, sku: string, ocupados: ReadonlySet<string>): string {
  let base = limpiar(nombre);
  if (base.length < 2) base = limpiar(sku);
  if (base.length < 2) base = 'producto';
  if (!ocupados.has(base)) return base;
  for (let n = 2; n <= 999; n += 1) {
    const c = `${base}-${String(n)}`;
    if (!ocupados.has(c)) return c;
  }
  throw new Error('No se pudo generar una clave libre para el producto');
}

/** Dos SKU que solo difieren en mayúsculas: permitido, pero se avisa. */
export const PARECIDO_SKU = 'Se parece al SKU de otro producto (difiere solo en mayúsculas)';
