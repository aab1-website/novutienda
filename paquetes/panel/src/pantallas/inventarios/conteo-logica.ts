import type { ConteoVista, ProductoDeConteo } from '../../api/tipos.js';
import { MAX_CANTIDAD, separar } from './movimientos-resumen.js';

/**
 * Lógica del conteo ciego. Nada de aquí lee las existencias del sistema: el conteo es ciego y lo que el servidor
 * calcula (el resultado al cerrar) llega ya hecho.
 */

type Linea = ConteoVista['lineas'][number];

/** Lo que la persona escribió, reducido a su forma comparable (el mismo número o las mismas series, sin importar espacios). */
export function normalizarTexto(p: Pick<ProductoDeConteo, 'conSerie'>, texto: string): string {
  if (p.conSerie) return separar(texto).join(' ');
  const t = texto.trim();
  return /^\d+$/.test(t) ? String(Number(t)) : t;
}

/** El texto con el que se ve una línea ya registrada. */
export function textoGuardado(p: Pick<ProductoDeConteo, 'conSerie'>, hecha: Linea | undefined): string {
  if (hecha === undefined) return '';
  return p.conSerie ? (hecha.series ?? []).join(' ') : String(hecha.contado);
}

/** Error junto al campo, o `null` si lo escrito se puede guardar. */
export function revisarTexto(p: Pick<ProductoDeConteo, 'conSerie'>, texto: string): string | null {
  if (p.conSerie) {
    const series = separar(texto);
    if (series.length === 0) return 'Escriba al menos una serie, separadas por espacio o coma.';
    if (new Set(series).size !== series.length) return 'Hay series repetidas.';
    return null;
  }
  const t = texto.trim();
  if (!/^\d+$/.test(t)) return 'Escriba un número entero de 0 o más.';
  if (Number(t) > MAX_CANTIDAD) return `El máximo es ${String(MAX_CANTIDAD)}.`;
  return null;
}

/** Cantidad de campos cuyo texto escrito aún no coincide con lo registrado (guardando, con error o sin salir del campo). */
export function contarPendientes(productos: readonly ProductoDeConteo[], borrador: Readonly<Record<string, string>>, lineas: readonly Linea[]): number {
  return productos.filter((p) => {
    const escrito = borrador[p.productoId];
    if (escrito === undefined) return false;
    const hecha = lineas.find((l) => l.productoId === p.productoId);
    if (escrito.trim() === '') return false;
    return normalizarTexto(p, escrito) !== normalizarTexto(p, textoGuardado(p, hecha));
  }).length;
}

/** «18 de 41»: productos de la lista que ya tienen su cantidad registrada. */
export function avance(productos: readonly ProductoDeConteo[], lineas: readonly Linea[]): { contados: number; total: number; texto: string } {
  const contados = productos.filter((p) => lineas.some((l) => l.productoId === p.productoId)).length;
  return { contados, total: productos.length, texto: `${String(contados)} de ${String(productos.length)}` };
}

/** Productos de la lista que aún no tienen cantidad registrada (tengan o no existencias: el panel no las conoce). */
export function sinContar(a: { contados: number; total: number }): number {
  return a.total - a.contados;
}

/** Lo que dice la confirmación al cerrar. El panel calcula «sin contar» con su propia lista; el servidor no lo informa. */
export function lineasDeCierre(a: { contados: number; total: number }): string[] {
  const res = [`Contó ${String(a.contados)} de ${String(a.total)} productos.`];
  const n = sinContar(a);
  if (n > 0) res.push(`Faltan ${String(n)} ${n === 1 ? 'producto' : 'productos'} por contar. Los que tengan existencias en el sistema se contarán en 0 y generarán mermas.`);
  else if (a.total > 0) res.push('No falta ningún producto por contar.');
  res.push('Los sobrantes se ingresan al stock. El cierre se firma con su usuario y no se deshace.');
  return res;
}
