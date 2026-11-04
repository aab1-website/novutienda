// `ConsultaSubidas` de la consola sobre Firestore. Usa el índice compuesto (estado, venceEn) de
// `firestore.indexes.json`: las más antiguas primero, que son las que hay que limpiar.
import type { Firestore } from 'firebase-admin/firestore';
import type { ConsultaSubidas } from '@plataforma/consola';

export function crearConsultaSubidas(firestore: Firestore): ConsultaSubidas {
  return {
    async listarPorEstado(tenantId, estado, limite) {
      const snap = await firestore
        .collection(`tenants/${tenantId}/subidas`)
        .where('estado', '==', estado)
        .orderBy('venceEn', 'asc')
        .limit(limite)
        .get();
      return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    },
  };
}
