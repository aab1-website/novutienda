// Compositor: aplica la regla de visibilidad de Inventarios (`recortarFaltantes`) al error de stock insuficiente que sale
// por los callables (venta del POS, merma, traspaso). Mientras un almacén tiene un conteo abierto, `caj` y `sup` no reciben
// la lista de faltantes (sería el stock); `adm` sí. La lectura de conteos solo ocurre cuando el error es de stock insuficiente.
import type { Firestore } from 'firebase-admin/firestore';
import { conteosAbiertosDe, MENSAJE_STOCK_OCULTO, recortarFaltantes, TraspasoBloqueadoPorConteo, type Conteos, type Faltante, type FaltantesVisibles } from '@novutienda/inventarios';
import type { Rol } from '@novutienda/nucleo';

type Obj = Readonly<Record<string, unknown>>;

/** Lector único de conteos abiertos: ubicaciones con `conteoAbiertoId` y el documento de cada conteo (la fuente de lectura la pone quien llama). */
export async function leerConteosAbiertos(
  ubicaciones: readonly { readonly id: string; readonly data: Obj }[],
  leerConteo: (conteoId: string) => Promise<Obj | undefined>,
): Promise<Conteos> {
  const ids = ubicaciones.map((u) => u.data['conteoAbiertoId']).filter((x): x is string => typeof x === 'string' && x !== '');
  const docs = await Promise.all(ids.map(async (id) => [id, await leerConteo(id)] as const));
  const porId = new Map(docs.filter((d): d is readonly [string, Obj] => d[1] !== undefined));
  return conteosAbiertosDe(ubicaciones, porId);
}

/**
 * Faltantes para `rol`: la lista, o `{ ocultos: true }` si alguno cae en un almacén en conteo y no es `adm`. Si no se pueden
 * leer los conteos, falla cerrado: nadie salvo `adm` recibe la lista.
 */
export async function faltantesVisibles(db: Firestore, tenantId: string, rol: Rol | undefined, faltantes: readonly Faltante[]): Promise<FaltantesVisibles> {
  if (rol === 'adm') return { ocultos: false, faltantes };
  try {
    const ubic = (await db.collection(`tenants/${tenantId}/ubicaciones`).get()).docs.map((u) => ({ id: u.id, data: u.data() as Obj }));
    const leerConteo = async (id: string): Promise<Obj | undefined> => {
      const d = await db.doc(`tenants/${tenantId}/conteos/${id}`).get();
      return d.exists ? (d.data() as Obj) : undefined;
    };
    return recortarFaltantes(rol, await leerConteosAbiertos(ubic, leerConteo), faltantes);
  } catch {
    return { ocultos: true };
  }
}

/** Los únicos `details` de un stock insuficiente con faltantes ocultos: sin lista, ids, cantidades ni número de líneas. */
export const DETALLES_STOCK_OCULTO = { codigo: 'stock-insuficiente', faltantesOcultos: true } as const;

/** Si `details` es el de un stock insuficiente, devuelve los de `rol` (sin lista si se ocultan); si no, lo devuelve igual. */
export async function recortarDetallesDeStock(db: Firestore, tenantId: string, rol: Rol | undefined, details: unknown): Promise<unknown> {
  if (typeof details !== 'object' || details === null) return details;
  const d = details as Record<string, unknown>;
  if (d['codigo'] !== 'stock-insuficiente' || !Array.isArray(d['faltantes'])) return details;
  const v = await faltantesVisibles(db, tenantId, rol, d['faltantes'] as Faltante[]);
  return v.ocultos ? { ...DETALLES_STOCK_OCULTO } : { ...d, faltantes: v.faltantes };
}

export { MENSAJE_STOCK_OCULTO };

/** Si el error es el bloqueo de un traspaso por conteo abierto, su mensaje y `details` (`{codigo, ubicacionId, conteoId, abiertoEn}`, sin cantidades). */
export function bloqueoPorConteo(error: unknown): { readonly mensaje: string; readonly details: Readonly<Record<string, unknown>> } | undefined {
  if (!(error instanceof TraspasoBloqueadoPorConteo)) return undefined;
  return { mensaje: error.message, details: { codigo: 'conteo-abierto', ubicacionId: error.ubicacionId, conteoId: error.conteoId, abiertoEn: error.abiertoEn } };
}
