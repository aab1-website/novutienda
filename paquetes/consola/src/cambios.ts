import type { TransaccionIdentidad } from '@novutienda/nucleo';
import { rutaSitio } from './rutas.js';

/** `sitio/estado`: contador de cambios hechos desde la última publicación (tablero). */
export interface EstadoSitio {
  readonly cambios: number;
  readonly ultimoCambioEn: string;
  /** Instante (ISO) en que la última publicación leyó el catálogo; los cambios de producto con `ocurridoEn` <= este ya salieron. */
  readonly corteCatalogoEn: string;
  /** Aviso de que un retiro automático dejó el sitio publicado sin productos o sin fotos; lo limpia una publicación correcta. */
  readonly avisoSitio: AvisoSitio | null;
}

export interface AvisoSitio {
  readonly motivo: 'sin_productos' | 'sin_fotos';
  /** Instante ISO del retiro que dejó el sitio incompleto. */
  readonly en: string;
}

export async function leerEstadoSitio(tx: TransaccionIdentidad, tenantId: string): Promise<EstadoSitio> {
  const d = (await tx.get(rutaSitio(tenantId, 'estado'))).data();
  const cambios = d?.['cambios'];
  const en = d?.['ultimoCambioEn'];
  const corte = d?.['corteCatalogoEn'];
  const a = d?.['avisoSitio'];
  const aviso: AvisoSitio | null = typeof a === 'object' && a !== null && !Array.isArray(a) &&
    ((a as Record<string, unknown>)['motivo'] === 'sin_productos' || (a as Record<string, unknown>)['motivo'] === 'sin_fotos') &&
    typeof (a as Record<string, unknown>)['en'] === 'string'
    ? { motivo: (a as Record<string, unknown>)['motivo'] as AvisoSitio['motivo'], en: (a as Record<string, unknown>)['en'] as string } : null;
  return {
    cambios: typeof cambios === 'number' && Number.isSafeInteger(cambios) && cambios >= 0 ? cambios : 0,
    ultimoCambioEn: typeof en === 'string' ? en : '',
    corteCatalogoEn: typeof corte === 'string' ? corte : '',
    avisoSitio: aviso,
  };
}

/**
 * Anota un cambio sin publicar. Debe llamarse después de TODAS las lecturas de la transacción. Conserva `corteCatalogoEn` y
 * `avisoSitio`; con `aviso` lo fija (sustituye al anterior).
 */
export function anotarCambio(tx: TransaccionIdentidad, tenantId: string, estado: EstadoSitio, ahoraIso: string, aviso?: AvisoSitio): void {
  const av = aviso ?? estado.avisoSitio;
  tx.set(rutaSitio(tenantId, 'estado'), {
    cambios: estado.cambios + 1, ultimoCambioEn: ahoraIso,
    ...(estado.corteCatalogoEn === '' ? {} : { corteCatalogoEn: estado.corteCatalogoEn }),
    ...(av === null ? {} : { avisoSitio: { motivo: av.motivo, en: av.en } }),
  });
}
