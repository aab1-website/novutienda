// `IndiceInvitaciones` sobre Firestore (las dos consultas que el puerto transaccional del núcleo no ofrece). Devuelven candidatos:
// el núcleo relee y confirma cada documento dentro de su transacción. Solo lo usa el servidor (Admin SDK): no requiere reglas.
import type { Firestore } from 'firebase-admin/firestore';
import type { IndiceInvitaciones } from '@novutienda/nucleo';

/** Tope de candidatos por consulta (el cupo `usuarios` ya acota las invitaciones por comercio; esto protege la lectura). */
const TOPE = 500;

export function crearIndiceInvitaciones(firestore: Firestore): IndiceInvitaciones {
  return {
    async invitadosDe(tenantId) {
      const s = await firestore.collection(`tenants/${tenantId}/miembros`).where('estado', '==', 'invitado').limit(TOPE).get();
      return s.docs.map((d) => d.id);
    },
    async tenantsDe(uid) {
      const s = await firestore.collectionGroup('miembros').where('uid', '==', uid).where('estado', '==', 'invitado').limit(TOPE).get();
      // El tenantId sale de la RUTA (`tenants/{t}/miembros/{uid}`), nunca de un campo del documento.
      const ids: string[] = [];
      for (const d of s.docs) {
        const partes = d.ref.path.split('/');
        if (partes.length === 4 && partes[0] === 'tenants' && partes[2] === 'miembros' && partes[3] === uid && partes[1] !== undefined) ids.push(partes[1]);
      }
      return ids;
    },
  };
}
