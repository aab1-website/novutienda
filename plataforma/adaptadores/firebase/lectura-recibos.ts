// `LecturaRecibos` de Recibos sobre Firestore: consultas indexadas por número (prefijo) y por fecha.
// La búsqueda por cliente y el acotado final los completa `buscarComprobantes`.
import type { Firestore, Query } from 'firebase-admin/firestore';
import type { LecturaRecibos, Recibo } from '@plataforma/recibos';

/** Tope de documentos que una consulta puede traer antes de filtrar en memoria. */
export const MAX_CANDIDATOS = 500;

export function crearLecturaRecibos(firestore: Firestore): LecturaRecibos {
  return {
    async consultar(tenantId, filtro) {
      let q: Query = firestore.collection(`tenants/${tenantId}/recibos`);
      if (filtro.numero !== undefined) {
        // Coincidencia por prefijo del número (A-0001…); el fragmento intermedio lo filtra el módulo.
        q = q.where('numero', '>=', filtro.numero).where('numero', '<=', `${filtro.numero}`).orderBy('numero', 'desc');
      } else {
        if (filtro.desde !== undefined) q = q.where('fecha', '>=', filtro.desde);
        if (filtro.hasta !== undefined) q = q.where('fecha', '<=', filtro.hasta);
        q = q.orderBy('fecha', 'desc');
      }
      const snap = await q.limit(MAX_CANDIDATOS).get();
      return snap.docs.map((d) => d.data() as unknown as Recibo);
    },
  };
}
