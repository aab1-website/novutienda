import type { AlmacenClaveValor } from './almacen.js';

/** Desde cuántas vistas reales la ficha muestra «N personas vieron este producto». */
export const MIN_VISTAS_VISIBLES = 10;
/** Un navegador cuenta como una «persona» por producto durante 24 horas. */
export const VENTANA_VISTA_MS = 24 * 60 * 60 * 1000;

const clave = (id: string): string => `cb.vista.${id}`;

/** ¿Este navegador ya contó una vista de este producto en las últimas 24 h? */
export function yaContoVista(almacen: AlmacenClaveValor | null, id: string, ahora: number): boolean {
  try {
    const t = Number(almacen?.getItem(clave(id)));
    return Number.isFinite(t) && t > 0 && ahora >= t && ahora - t < VENTANA_VISTA_MS;
  } catch {
    return false;
  }
}

export function marcarVista(almacen: AlmacenClaveValor | null, id: string, ahora: number): void {
  try {
    almacen?.setItem(clave(id), String(ahora));
  } catch {
    /* sin almacenamiento: se cuenta cada visita; el límite por origen del servidor lo acota */
  }
}

export function textoVistas(n: number): string | null {
  return Number.isInteger(n) && n >= MIN_VISTAS_VISIBLES ? `${n} personas vieron este producto` : null;
}
