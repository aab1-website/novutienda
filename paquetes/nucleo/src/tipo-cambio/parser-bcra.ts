/**
 * Parser del Dólar Referencia Comunicación A 3500 del BCRA (control cruzado y respaldo).
 *
 * FUENTE (verificada el 04/11/2026): API de Estadísticas Cambiarias v1.0 del
 * BCRA, listada en el catálogo oficial de APIs del BCRA (`bcra.gob.ar`),
 * sin token. Se probó `GET https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones`
 * (todas las monedas, `results` = objeto `{fecha, detalle[]}`) y
 * `GET .../Cotizaciones/REF` (`results` = arreglo de `{fecha, detalle[]}`).
 * La A 3500 viene con `codigoMoneda: "REF"`, descripción «DOLAR REFERENCIA COM
 * 3500», valor en `tipoCotizacion` (pesos por USD; ese día 1549.7194 al
 * 03/11/2026). En la consulta de la mañana del 04/11 la fecha más reciente era
 * la del día hábil anterior. NO se verificó en la documentación el horario de
 * publicación de la A 3500. El `USD` de la misma API es otra cosa (tipo de
 * cotización de divisas), no la A 3500.
 */
import type { Lectura, ResultadoLectura } from './tipos.js';
import { esFechaIso } from './texto.js';

export const URL_COTIZACIONES_BCRA = 'https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/REF';

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Lee la respuesta JSON ya parseada. Toma el REF de la fecha más reciente. */
export function leerCotizacionesBcra(json: unknown): ResultadoLectura<Lectura> {
  if (!esObjeto(json) || json['status'] !== 200) return { ok: false, motivo: 'respuesta del BCRA sin status 200' };
  const results = json['results'];
  const dias: unknown[] = Array.isArray(results) ? results : [results];
  const candidatos: { fecha: string; valor: number }[] = [];
  for (const dia of dias) {
    if (!esObjeto(dia) || !esFechaIso(dia['fecha']) || !Array.isArray(dia['detalle'])) continue;
    for (const d of dia['detalle'] as unknown[]) {
      if (!esObjeto(d) || d['codigoMoneda'] !== 'REF') continue;
      const v = d['tipoCotizacion'];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) candidatos.push({ fecha: dia['fecha'], valor: v });
    }
  }
  if (candidatos.length === 0) return { ok: false, motivo: 'sin cotización REF (A 3500) en la respuesta' };
  const reciente = candidatos.reduce((a, b) => (b.fecha > a.fecha ? b : a));
  return { ok: true, lectura: { valor: reciente.valor, fecha: reciente.fecha, fuente: 'BCRA' } };
}
