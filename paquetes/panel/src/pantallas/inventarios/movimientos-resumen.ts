import type { LineaIngreso, ProductoPanel, UbicacionId } from '../../api/tipos.js';
import { nombreAlmacen } from './nombres.js';

/** Revisión y resumen de ingreso, traspaso y ajuste. Vistas previas: el stock lo escribe y valida solo el servidor. */

export interface FilaLinea {
  id: string;
  productoId: string;
  cantidad: string;
  series: string;
}

export const TEXTO_EXISTENCIAS_OCULTAS = 'Las existencias están ocultas mientras hay un conteo abierto; el servidor valida al registrar.';

export const MAX_CANTIDAD = 1_000_000;
export const MAX_LINEAS = 50;
const SERIE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const separar = (t: string): string[] => t.split(/[\s,;]+/).filter((s) => s !== '');

/** Claves de error de una línea. */
export const claveLinea = (fila: FilaLinea, campo: 'producto' | 'cantidad' | 'series'): string => `${fila.id}.${campo}`;

export interface RevisionLineas {
  readonly errores: Readonly<Record<string, string>>;
  /** Solo si no hay errores. */
  readonly lineas: readonly LineaIngreso[] | null;
}

/** `origen`: en un traspaso, el almacén del que sale (se avisa si pide más de lo que hay). */
export function revisarLineas(filas: readonly FilaLinea[], productos: readonly ProductoPanel[], origen?: UbicacionId | null): RevisionLineas {
  const errores: Record<string, string> = {};
  const lineas: LineaIngreso[] = [];
  const pedido = new Map<string, number>();
  for (const f of filas) {
    const p = productos.find((x) => x.id === f.productoId);
    if (p === undefined) {
      errores[claveLinea(f, 'producto')] = 'Elija un producto de la lista.';
      continue;
    }
    if (p.conSerie) {
      const s = separar(f.series);
      if (s.length === 0) errores[claveLinea(f, 'series')] = 'Escriba al menos una serie, una por unidad.';
      else if (new Set(s).size !== s.length) errores[claveLinea(f, 'series')] = 'Hay series repetidas. Cada unidad lleva una serie distinta.';
      else if (s.some((x) => !SERIE.test(x) || x.includes('__'))) errores[claveLinea(f, 'series')] = 'Una serie tiene caracteres no válidos. Use letras, números, punto, guion o guion bajo.';
      else lineas.push({ productoId: p.id, cantidad: s.length, series: s });
      continue;
    }
    const t = f.cantidad.trim();
    if (!/^\d+$/.test(t)) {
      errores[claveLinea(f, 'cantidad')] = t === '' ? 'Escriba la cantidad.' : 'Escriba un número entero, sin decimales ni signos, por ejemplo 3.';
      continue;
    }
    const n = Number(t);
    if (n < 1 || n > MAX_CANTIDAD) {
      errores[claveLinea(f, 'cantidad')] = `La cantidad va de 1 a ${String(MAX_CANTIDAD)}.`;
      continue;
    }
    if (origen != null) {
      const total = (pedido.get(p.id) ?? 0) + n;
      pedido.set(p.id, total);
      const hay = p.existencias[origen];
      // Oculta por un conteo abierto: no se puede comparar; valida el servidor.
      if (hay !== null && total > hay) {
        errores[claveLinea(f, 'cantidad')] = `En ${nombreAlmacen(origen)} hay ${String(hay)} de «${p.nombre}»; no se pueden pasar ${String(total)}.`;
        continue;
      }
    }
    lineas.push({ productoId: p.id, cantidad: n });
  }
  return { errores, lineas: Object.keys(errores).length > 0 ? null : lineas };
}

const nombreDe = (productos: readonly ProductoPanel[], id: string): string => productos.find((p) => p.id === id)?.nombre ?? id;

/** Una línea del resumen: «5 × Cable HDMI 2 m» o «3 series de Celular (N-1, N-2, N-3)». */
export function textoLinea(l: LineaIngreso, productos: readonly ProductoPanel[]): string {
  const nombre = nombreDe(productos, l.productoId);
  if (l.series !== undefined) return `${String(l.series.length)} ${l.series.length === 1 ? 'serie' : 'series'} de ${nombre} (${l.series.join(', ')})`;
  return `${String(l.cantidad)} × ${nombre}`;
}

export interface Resumen {
  readonly titulo: string;
  readonly lineas: readonly string[];
  readonly confirmar: string;
}

export function resumenIngreso(lineas: readonly LineaIngreso[], destino: UbicacionId, productos: readonly ProductoPanel[]): Resumen {
  return { titulo: '¿Registrar este ingreso?', lineas: [`Entra a ${nombreAlmacen(destino)}:`, ...lineas.map((l) => textoLinea(l, productos))], confirmar: 'Sí, registrar el ingreso' };
}

export function resumenTraspaso(lineas: readonly LineaIngreso[], origen: UbicacionId, destino: UbicacionId, productos: readonly ProductoPanel[]): Resumen {
  return { titulo: '¿Registrar este traspaso?', lineas: [`De ${nombreAlmacen(origen)} a ${nombreAlmacen(destino)}:`, ...lineas.map((l) => textoLinea(l, productos))], confirmar: 'Sí, traspasar' };
}

/** «Hay 12, quedarán 10»; `null` si todavía faltan el producto, el almacén o la diferencia, o si la existencia está oculta. */
export function haySeQuedan(p: ProductoPanel | undefined, ubicacion: UbicacionId | null, delta: number | null): { hay: number; quedan: number; texto: string } | null {
  if (p === undefined || ubicacion === null || delta === null) return null;
  const hay = p.existencias[ubicacion];
  if (hay === null) return null;
  const quedan = hay + delta;
  return { hay, quedan, texto: `Hay ${String(hay)}, quedarán ${String(quedan)}` };
}

/** Diferencia de un ajuste: entero distinto de 0, con signo opcional. `null` si no lo es. */
export function leerDiferencia(t: string): number | null {
  const s = t.trim().replace(/^\+/, '');
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  return n === 0 || !Number.isSafeInteger(n) ? null : n;
}

export interface ErroresAjuste {
  readonly producto?: string;
  readonly almacen?: string;
  readonly diferencia?: string;
  readonly motivo?: string;
}

export function revisarAjuste(p: ProductoPanel | undefined, ubicacion: UbicacionId | null, diferencia: string, motivo: string): ErroresAjuste {
  const e: { -readonly [K in keyof ErroresAjuste]: ErroresAjuste[K] } = {};
  if (p === undefined) e.producto = 'Elija un producto de la lista.';
  if (ubicacion === null) e.almacen = 'Elija el almacén.';
  const d = leerDiferencia(diferencia);
  if (diferencia.trim() === '') e.diferencia = 'Escriba la diferencia: positiva suma, negativa resta.';
  else if (d === null) e.diferencia = 'Escriba un número entero distinto de 0, por ejemplo 5 o -2. Sin decimales.';
  else {
    const r = haySeQuedan(p, ubicacion, d);
    if (r !== null && r.quedan < 0) e.diferencia = `${r.texto}: no puede quedar en negativo. Hay ${String(r.hay)} en ${nombreAlmacen(ubicacion ?? '')}.`;
  }
  if (motivo.trim() === '') e.motivo = 'Escriba el motivo del ajuste.';
  else if (motivo.length > 500) e.motivo = 'Máximo 500 caracteres.';
  return e;
}

/** Lo que se sabe de las existencias al abrir la confirmación: leyendo, la cifra fresca o la lectura falló. */
export type LecturaExistencia = { readonly estado: 'cargando' } | { readonly estado: 'fallo' } | { readonly estado: 'oculta' } | { readonly estado: 'ok'; readonly hay: number };

/** Lectura de una existencia que puede venir oculta (`null`). */
export const lecturaDe = (hay: number | null): LecturaExistencia => (hay === null ? { estado: 'oculta' } : { estado: 'ok', hay });

/**
 * Resumen del ajuste. La cifra «Hay N, quedarán M» sale de `lectura` (existencias leídas al abrir la confirmación), no de
 * las leídas al montar la pantalla; si la lectura falla se muestra sin cifra y se avisa que el servidor valida al registrar.
 */
export function resumenAjuste(p: ProductoPanel, ubicacion: UbicacionId, delta: number, motivo: string, lectura: LecturaExistencia = lecturaDe(p.existencias[ubicacion])): Resumen {
  const encabezado = `${p.nombre} en ${nombreAlmacen(ubicacion)}`;
  const principal =
    lectura.estado === 'ok' ? `${encabezado}: Hay ${String(lectura.hay)}, quedarán ${String(lectura.hay + delta)}.`
    : lectura.estado === 'oculta' ? `${encabezado}: ${TEXTO_EXISTENCIAS_OCULTAS}`
    : lectura.estado === 'cargando' ? `${encabezado}: leyendo las existencias actuales…`
    : `${encabezado}: no se pudieron leer las existencias actuales; el servidor valida al registrar.`;
  return {
    titulo: '¿Aplicar este ajuste?',
    lineas: [principal, `Diferencia: ${delta > 0 ? '+' : ''}${String(delta)}.`, `Motivo: ${motivo.trim()}.`],
    confirmar: 'Sí, aplicar el ajuste',
  };
}
