// `LecturaRecibos` de Recibos sobre Firestore: consultas indexadas por número (prefijo o exacto sin serie) y por fecha.
// La búsqueda por cliente y el acotado final los completa `buscarComprobantes`.
import type { Firestore, Query } from 'firebase-admin/firestore';
import type { LecturaRecibos, Recibo } from '@novutienda/recibos';

/** Tope de documentos que una consulta puede traer antes de filtrar en memoria. */
export const MAX_CANDIDATOS = 500;

/** Cota superior de un prefijo en Firestore: el último carácter BMP (escrito explícito, no un carácter invisible). */
const FIN_PREFIJO = '\uf8ff';
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
      if (numero !== undefined && numero.includes('-')) {
        // Número con serie (A-0001…): prefijo indexado; el fragmento intermedio lo filtra el módulo.
        q = q.where('numero', '>=', numero).where('numero', '<=', `${numero}${FIN_PREFIJO}`).orderBy('numero', 'desc');
      } else if (numero !== undefined && /^\d{1,6}$/.test(numero)) {
        // Número sin serie («123» o «000123»): consulta exacta por «{serie}-{correlativo}» para cada serie del tenant.
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
