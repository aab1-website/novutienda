// `LecturaRecibos` de Recibos sobre Firestore: consultas indexadas por número (exacto, con o sin serie) y por fecha.
// La búsqueda por cliente y el acotado final los completa `buscarComprobantes`.
import type { Firestore, Query } from 'firebase-admin/firestore';
import { interpretarNumeroRecibo, numeroDeRecibo } from '@novutienda/nucleo';
import type { LecturaRecibos, Recibo } from '@novutienda/recibos';

/** Tope de documentos que una consulta puede traer antes de filtrar en memoria. */
export const MAX_CANDIDATOS = 500;

/** Largo del correlativo del número (A-000123). */
const LARGO_CORRELATIVO = 6;
/** `in` de Firestore admite hasta 30 valores. */
const MAX_SERIES = 30;

/**
 * Series de recibo del tenant, tomadas de sus contadores (`contadores/recibo_{serie}`): con ellas un número sin serie
 * («000123») se resuelve a «A-000123» con una consulta exacta indexada, aunque la serie haya cambiado con el tiempo.
 */
async function seriesDelTenant(firestore: Firestore, tenantId: string): Promise<string[]> {
  const refs = await firestore.collection(`tenants/${tenantId}/contadores`).listDocuments();
  return refs.map((r) => r.id).filter((id) => id.startsWith('recibo_')).map((id) => id.slice('recibo_'.length)).slice(0, MAX_SERIES);
}

export function crearLecturaRecibos(firestore: Firestore): LecturaRecibos {
  return {
    async consultar(tenantId, filtro) {
      let q: Query = firestore.collection(`tenants/${tenantId}/recibos`);
      // Las series son mayúsculas: la búsqueda no distingue mayúsculas porque se normaliza aquí.
      const numero = filtro.numero?.trim().toUpperCase();
      const conSerie = numero === undefined ? null : interpretarNumeroRecibo(numero);
      if (conSerie?.serie !== undefined) {
        // Con serie llega la forma canónica («A-000006»): consulta exacta por el número impreso, sin depender de la fecha.
        q = q.where('numero', '==', numeroDeRecibo(conSerie.serie, conSerie.numero));
      } else if (numero !== undefined && /^\d{1,6}$/.test(numero)) {
        // Sin serie («6» o «000006»; el documento no guarda el correlativo aparte): consulta exacta por
        // «{serie}-{correlativo}» para cada serie del tenant, también independiente de la fecha.
        const series = await seriesDelTenant(firestore, tenantId);
        if (series.length === 0) return [];
        const correlativo = numero.padStart(LARGO_CORRELATIVO, '0');
        q = q.where('numero', 'in', series.map((serie) => `${serie}-${correlativo}`));
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
