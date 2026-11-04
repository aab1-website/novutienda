/**
 * Parser del TCO oficial del BCB (Bolivia).
 *
 * FUENTE (verificada el 04/11/2026): tabla HTML pública que carga la página
 * «Tipos de cambio» del BCB, `https://www.bcb.gob.bo/librerias/indicadores/otras/ultimo.php`
 * (HTTP 200, ~11 KB). NO hay API JSON oficial: se lee la tabla. Trae «FECHA DE
 * LA COTIZACIÓN», «TABLA DE COTIZACIONES DEL <fecha>» y la fila USD de la tabla
 * «Tipo de Cambio Oficial (TCO) (Bs/USD)» (ese día: 12.06). El BCB publica la
 * tabla del día siguiente de noche (~20:00 hábil) y no publica fines de semana
 * ni feriados; el horario exacto no está documentado en la fuente y no se
 * verificó.
 */
import type { Lectura, ResultadoLectura } from './tipos.js';
import { filasDe, numeroDe, plano } from './texto.js';

export const URL_TABLA_BCB = 'https://www.bcb.gob.bo/librerias/indicadores/otras/ultimo.php';

const MESES: Readonly<Record<string, string>> = {
  enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06', julio: '07',
  agosto: '08', septiembre: '09', setiembre: '09', octubre: '10', noviembre: '11', diciembre: '12',
};

/** «4 de Noviembre 2026» o «4 DE NOVIEMBRE DE 2026» → «2026-11-04»; si no, null. */
function fechaDe(texto: string): string | null {
  const m = /(\d{1,2}) de ([a-z]+)(?: de)? (\d{4})/i.exec(texto);
  if (!m) return null;
  const mes = MESES[m[2]!.toLowerCase()];
  if (!mes) return null;
  return `${m[3]}-${mes}-${m[1]!.padStart(2, '0')}`;
}

/**
 * Lee la tabla del BCB. PURA. Exige que la fecha del rótulo y la del título
 * coincidan y que la tabla del TCO tenga una sola fila USD con un número.
 */
export function leerTablaBcb(html: string): ResultadoLectura<Lectura> {
  const texto = plano(html);
  const rotulo = /FECHA DE LA COTIZACION: ([^|]{0,60}?\d{4})/i.exec(texto);
  const titulo = /TABLA DE COTIZACIONES DEL ([^|]{0,60}?\d{4})/i.exec(texto);
  const fecha = rotulo ? fechaDe(rotulo[1]!) : null;
  const fechaTitulo = titulo ? fechaDe(titulo[1]!) : null;
  if (!fecha) return { ok: false, motivo: 'sin fecha de la cotización' };
  if (fechaTitulo !== fecha) return { ok: false, motivo: 'las dos fechas de la página no coinciden' };

  const inicio = html.search(/Tipo de Cambio Oficial \(TCO\)/i);
  if (inicio < 0) return { ok: false, motivo: 'sin la tabla del TCO' };
  const fin = html.indexOf('</table>', inicio);
  const filas = filasDe(html.slice(inicio, fin < 0 ? undefined : fin)).filter((celdas) => celdas.includes('USD'));
  if (filas.length !== 1) return { ok: false, motivo: `se esperaba una fila USD y hay ${filas.length}` };
  const celda = filas[0]![filas[0]!.length - 1] ?? '';
  const valor = /^\d{1,2}[.,]\d{1,4}$/.test(celda) ? numeroDe(celda) : null;
  if (valor === null || valor <= 0) return { ok: false, motivo: 'el TCO no es un número' };
  return { ok: true, lectura: { valor, fecha, fuente: 'BCB' } };
}
