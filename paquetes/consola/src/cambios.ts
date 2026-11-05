import type { TransaccionIdentidad } from '@novutienda/nucleo';
import { rutaSitio } from './rutas.js';

/** `sitio/estado`: contador de cambios hechos desde la última publicación (tablero). */
export interface EstadoSitio {
  readonly cambios: number;
  readonly ultimoCambioEn: string;
}

export async function leerEstadoSitio(tx: TransaccionIdentidad, tenantId: string): Promise<EstadoSitio> {
  const d = (await tx.get(rutaSitio(tenantId, 'estado'))).data();
  const cambios = d?.['cambios'];
  const en = d?.['ultimoCambioEn'];
  return {
    cambios: typeof cambios === 'number' && Number.isSafeInteger(cambios) && cambios >= 0 ? cambios : 0,
    ultimoCambioEn: typeof en === 'string' ? en : '',
  };
}

/** Anota un cambio sin publicar. Debe llamarse después de TODAS las lecturas de la transacción. */
export function anotarCambio(tx: TransaccionIdentidad, tenantId: string, estado: EstadoSitio, ahoraIso: string): void {
  tx.set(rutaSitio(tenantId, 'estado'), { cambios: estado.cambios + 1, ultimoCambioEn: ahoraIso });
}
