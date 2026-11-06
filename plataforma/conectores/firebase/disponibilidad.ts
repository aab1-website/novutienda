// `LectorDisponibilidad` del sitio sobre `existenciasPublicas/{productoId}` (la proyección que Inventarios
// recalcula con su regla única). Solo se lee el booleano `disponible`; nunca cantidades.
import type { Firestore } from 'firebase-admin/firestore';
import type { LectorDisponibilidad } from '@novutienda/website';

export function crearLectorDisponibilidad(firestore: Firestore, tenantId: string): LectorDisponibilidad {
  return async (ids) => {
    if (ids.length === 0) return {};
    const refs = ids.map((id) => firestore.doc(`tenants/${tenantId}/existenciasPublicas/${id}`));
    const docs = await firestore.getAll(...refs, { fieldMask: ['disponible'] });
    const salida: Record<string, boolean> = {};
    docs.forEach((d, i) => {
      const id = ids[i];
      const v = d.exists ? d.get('disponible') : undefined;
      if (id !== undefined && typeof v === 'boolean') salida[id] = v;
    });
    return salida;
  };
}
