import type { Rol } from '@novutienda/nucleo';
import { UBICACION_DISPONIBILIDAD } from './disponibilidad.js';
import type { Faltante } from './errores.js';

/**
 * ÚNICO punto de decisión de «quién ve las existencias» mientras hay un conteo abierto. Todo callable que entregue
 * cantidades (o algo derivable de ellas) a `caj` o `sup` pasa por aquí; `adm` ve siempre todo.
 *
 * Reglas (alcance):
 * - Las existencias de una ubicación con conteo abierto se ocultan a quien no es `adm`.
 * - `stockTotal` y `bajoMinimo` se ocultan si hay CUALQUIER conteo abierto: se calcularían restando los almacenes visibles.
 * - `disponible` sale de la ubicación `UBICACION_DISPONIBILIDAD` («tienda», ver `disponibilidad.ts`): se oculta solo si ESA
 *   ubicación está en conteo. Un producto que no controla stock (`stockTotal` ausente) conserva `disponible` (solo depende de
 *   `activo`, no revela nada).
 * - En los movimientos, `saldoTotal` se quita si hay cualquier conteo abierto y `saldoUbicacion` si la ubicación del
 *   movimiento está en conteo (de todas las fechas: un saldo viejo más los deltas posteriores da la existencia actual).
 *   Los movimientos mismos no se ocultan.
 * - La respuesta MARCA el ocultamiento (`existenciasOcultas: true` y `conteosAbiertos`); lo oculto va como `null`, no se
 *   omite, porque `stockTotal` ausente ya significa «no controla stock».
 */
export interface ConteoAbierto {
  readonly ubicacionId: string;
  readonly conteoId: string;
  /** ISO 8601 de cuándo se abrió, o `null` si el documento del conteo no lo trae. */
  readonly abiertoEn: string | null;
}

export type Conteos = readonly ConteoAbierto[];

/** Marca que se agrega a toda respuesta con ocultamiento. */
export interface MarcaOcultamiento {
  readonly existenciasOcultas: true;
  readonly conteosAbiertos: Conteos;
}

const aIso = (v: unknown): string | null => {
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object' && v !== null && typeof (v as { toDate?: unknown }).toDate === 'function') return (v as { toDate(): Date }).toDate().toISOString();
  return null;
};

/**
 * Conteos abiertos a partir de los documentos de `ubicaciones` (la fuente de verdad del bloqueo: `conteoAbiertoId`) y de los
 * documentos `conteos` por id (solo para `abiertoEn`). Si falta el documento del conteo igual se oculta (falla cerrado).
 */
export function conteosAbiertosDe(
  ubicaciones: readonly { readonly id: string; readonly data: Readonly<Record<string, unknown>> }[],
  conteosPorId: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
): Conteos {
  return ubicaciones
    .filter((u) => typeof u.data['conteoAbiertoId'] === 'string' && u.data['conteoAbiertoId'] !== '')
    .map((u) => {
      const conteoId = u.data['conteoAbiertoId'] as string;
      return { ubicacionId: u.id, conteoId, abiertoEn: aIso(conteosPorId.get(conteoId)?.['abiertoEn']) };
    })
    .sort((a, b) => a.ubicacionId.localeCompare(b.ubicacionId));
}

/** `adm` siempre ve; los demás ven la ubicación solo si no tiene un conteo abierto. */
export function puedeVerExistencias(rol: Rol | undefined, ubicacionId: string, conteos: Conteos): boolean {
  return rol === 'adm' || !conteos.some((c) => c.ubicacionId === ubicacionId);
}

/** `true` si a este rol se le oculta algo (cualquier conteo abierto y no es `adm`). */
export function hayOcultamiento(rol: Rol | undefined, conteos: Conteos): boolean {
  return rol !== 'adm' && conteos.length > 0;
}

export function marcaOcultamiento(rol: Rol | undefined, conteos: Conteos): MarcaOcultamiento | undefined {
  return hayOcultamiento(rol, conteos) ? { existenciasOcultas: true, conteosAbiertos: conteos } : undefined;
}

export interface ProductoVisible {
  readonly stockTotal?: number;
  readonly bajoMinimo: boolean;
  readonly existencias: Readonly<Record<string, number>>;
  readonly disponible: boolean;
}

export interface ProductoProyectado {
  readonly stockTotal?: number | null;
  readonly bajoMinimo: boolean | null;
  readonly existencias: Readonly<Record<string, number | null>>;
  readonly disponible: boolean | null;
}

/**
 * Proyección de un producto. Solo los productos que controlan stock (`stockTotal` definido) tienen algo que ocultar.
 * Las ubicaciones ocultas salen como `null` para TODOS los productos que controlan stock (así no se revela en qué ubicación
 * hay documento de existencia), y las visibles se entregan tal cual.
 */
export function proyectarProducto(rol: Rol | undefined, conteos: Conteos, p: ProductoVisible, ubicaciones: readonly string[]): ProductoProyectado {
  if (!hayOcultamiento(rol, conteos) || p.stockTotal === undefined) return { ...p };
  const existencias: Record<string, number | null> = {};
  for (const [u, n] of Object.entries(p.existencias)) if (puedeVerExistencias(rol, u, conteos)) existencias[u] = n;
  for (const u of ubicaciones) if (!puedeVerExistencias(rol, u, conteos)) existencias[u] = null;
  return {
    stockTotal: null,
    bajoMinimo: null,
    existencias,
    disponible: puedeVerExistencias(rol, UBICACION_DISPONIBILIDAD, conteos) ? p.disponible : null,
  };
}

export interface UnidadVisible {
  readonly estado: unknown;
  readonly ubicacionId: unknown;
}

/**
 * Unidades con serie para una lista (`series`): a quien no es `adm` se le quitan las DISPONIBLES de una ubicación en conteo
 * (su número sería el stock). Las vendidas o en merma no son existencias y se conservan.
 */
export function filtrarUnidadesLista<U extends UnidadVisible>(rol: Rol | undefined, conteos: Conteos, unidades: readonly U[]): U[] {
  return unidades.filter((u) => u.estado !== 'disponible' || typeof u.ubicacionId !== 'string' || puedeVerExistencias(rol, u.ubicacionId, conteos));
}

/** Quita los saldos de un movimiento según el rol y los conteos (D3: los movimientos no se ocultan, solo sus saldos). */
export function proyectarMovimiento(rol: Rol | undefined, conteos: Conteos, m: Readonly<Record<string, unknown>>): Record<string, unknown> {
  if (!hayOcultamiento(rol, conteos)) return { ...m };
  const { saldoTotal: _t, ...resto } = m;
  void _t;
  const ubic = typeof m['ubicacionId'] === 'string' ? m['ubicacionId'] : '';
  if (puedeVerExistencias(rol, ubic, conteos)) return resto;
  const { saldoUbicacion: _u, ...sinSaldos } = resto;
  void _u;
  return sinSaldos;
}

/** Detalle de un `StockInsuficiente` para quien consulta: la lista completa o solo el aviso de que se ocultó. */
export type FaltantesVisibles = { readonly ocultos: false; readonly faltantes: readonly Faltante[] } | { readonly ocultos: true };

/**
 * Faltantes de un `StockInsuficiente` para quien no es `adm`: con CUALQUIER conteo abierto en el tenant (el mismo criterio que
 * oculta `stockTotal`, `hayOcultamiento`) no se entrega ninguno (ni ids, ni cantidades, ni cuántos): solo `ocultos: true`, sea
 * cual sea el almacén de los faltantes. Una venta combina líneas de varios almacenes: si el recorte dependiera del almacén del
 * faltante, una línea testigo sin stock en otro almacén permitiría distinguir «stock ≥ N» de «< N» en el almacén en conteo.
 * Sin conteos abiertos, o para `adm`, la lista completa. Rol ausente o desconocido ⇒ oculto. El coordinador lo aplica al traducir el error.
 */
export function recortarFaltantes(rol: Rol | undefined, conteos: Conteos, faltantes: readonly Faltante[]): FaltantesVisibles {
  if (hayOcultamiento(rol, conteos)) return { ocultos: true };
  return { ocultos: false, faltantes: [...faltantes] };
}

/** Texto del error de stock cuando los faltantes se ocultan (sin productos, almacenes ni cantidades). */
export const MENSAJE_STOCK_OCULTO = 'Stock insuficiente.';

/**
 * Traspasos: `caj` y `sup` no pueden traspasar desde ni hacia una ubicación con conteo abierto; `adm` sí. Falla cerrado con
 * rol ausente o desconocido. Devuelve el conteo que bloquea (el del origen primero), o `undefined` si puede seguir.
 */
export function conteoQueBloqueaTraspaso(rol: Rol | undefined, conteos: Conteos, origenId: string, destinoId: string): ConteoAbierto | undefined {
  if (rol === 'adm') return undefined;
  return conteos.find((c) => c.ubicacionId === origenId) ?? conteos.find((c) => c.ubicacionId === destinoId);
}
