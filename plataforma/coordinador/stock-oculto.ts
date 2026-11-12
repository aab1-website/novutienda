// Compositor: aplica la regla de visibilidad de Inventarios (`recortarFaltantes`) al error de stock insuficiente que sale
// por los callables (venta del POS, merma, traspaso). Mientras un almacén tiene un conteo abierto, `caj` y `sup` no reciben
// `disponible` (sería el stock); `adm` sí. La lectura de conteos solo ocurre cuando el error es de stock insuficiente.
import type { Firestore } from 'firebase-admin/firestore';
import { conteosAbiertosDe, recortarFaltantes, type Conteos, type Faltante } from '@novutienda/inventarios';
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

/** `details.faltantes` ya recortados para `rol`. Si no se pueden leer los conteos, falla cerrado: nadie salvo `adm` recibe `disponible`. */
export async function faltantesVisibles(db: Firestore, tenantId: string, rol: Rol | undefined, faltantes: readonly Faltante[]): Promise<unknown[]> {
  if (rol === 'adm') return [...faltantes];
  try {
    const ubic = (await db.collection(`tenants/${tenantId}/ubicaciones`).get()).docs.map((u) => ({ id: u.id, data: u.data() as Obj }));
    const leerConteo = async (id: string): Promise<Obj | undefined> => {
      const d = await db.doc(`tenants/${tenantId}/conteos/${id}`).get();
      return d.exists ? (d.data() as Obj) : undefined;
    };
    return recortarFaltantes(rol, await leerConteosAbiertos(ubic, leerConteo), faltantes);
  } catch {
    return faltantes.map(({ disponible: _d, ...resto }) => (void _d, resto));
  }
}

/** Si `details` es el de un stock insuficiente, devuelve una copia con los faltantes recortados; si no, lo devuelve igual. */
export async function recortarDetallesDeStock(db: Firestore, tenantId: string, rol: Rol | undefined, details: unknown): Promise<unknown> {
  if (typeof details !== 'object' || details === null) return details;
  const d = details as Record<string, unknown>;
  if (d['codigo'] !== 'stock-insuficiente' || !Array.isArray(d['faltantes'])) return details;
  return { ...d, faltantes: await faltantesVisibles(db, tenantId, rol, d['faltantes'] as Faltante[]) };
}
