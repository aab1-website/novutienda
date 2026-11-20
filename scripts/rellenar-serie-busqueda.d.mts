export const TAMANO_LOTE: number;
export function normalizarSerieBusqueda(serie: string): string;
export interface CifrasRelleno { revisadas: number; aActualizar: number; actualizadas: number; sinSerie: number }
export function rellenar(o: { firestore: unknown; tenant: string; escribir?: boolean; tamanoLote?: number }): Promise<CifrasRelleno>;
