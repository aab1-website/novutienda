/** Carrito de consulta: lista de productos y cantidades, sin precios (el precio se confirma por WhatsApp). */

export interface LineaCarrito {
  readonly id: string;
  readonly nombre: string;
  readonly cantidad: number;
}
export type Carrito = readonly LineaCarrito[];

export const MAX_LINEAS = 50;
export const MAX_CANTIDAD = 99;
export const CLAVE_CARRITO = 'cb.carrito';

const limitar = (n: number): number => Math.min(MAX_CANTIDAD, Math.max(1, Math.trunc(n)));

export function agregar(c: Carrito, item: { readonly id: string; readonly nombre: string }, cantidad = 1): Carrito {
  const i = c.findIndex((l) => l.id === item.id);
  if (i >= 0) return c.map((l, j) => (j === i ? { ...l, cantidad: limitar(l.cantidad + cantidad) } : l));
  if (c.length >= MAX_LINEAS) return c;
  return [...c, { id: item.id, nombre: item.nombre, cantidad: limitar(cantidad) }];
}

export const quitar = (c: Carrito, id: string): Carrito => c.filter((l) => l.id !== id);

/** Cambia la cantidad; llegar a cero quita la línea. */
export function cambiarCantidad(c: Carrito, id: string, delta: number): Carrito {
  return c.flatMap((l) => {
    if (l.id !== id) return [l];
    const n = l.cantidad + delta;
    return n <= 0 ? [] : [{ ...l, cantidad: limitar(n) }];
  });
}

export const totalUnidades = (c: Carrito): number => c.reduce((s, l) => s + l.cantidad, 0);

/** Lee el carrito guardado sin confiar en él: descarta todo lo que no tenga la forma esperada. */
export function leerCarrito(crudo: string | null): Carrito {
  if (crudo === null) return [];
  try {
    const x: unknown = JSON.parse(crudo);
    if (!Array.isArray(x)) return [];
    const lineas: LineaCarrito[] = [];
    for (const it of x.slice(0, MAX_LINEAS)) {
      if (typeof it !== 'object' || it === null) continue;
      const { id, nombre, cantidad } = it as Record<string, unknown>;
      if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,59}$/.test(id)) continue;
      if (typeof nombre !== 'string' || nombre === '' || nombre.length > 120) continue;
      if (typeof cantidad !== 'number' || !Number.isFinite(cantidad)) continue;
      if (lineas.some((l) => l.id === id)) continue;
      lineas.push({ id, nombre, cantidad: limitar(cantidad) });
    }
    return lineas;
  } catch {
    return [];
  }
}

export const serializarCarrito = (c: Carrito): string => JSON.stringify(c);
