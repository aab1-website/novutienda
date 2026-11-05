/** Utilidades de texto compartidas por los parsers (puras). */

/** Quita las etiquetas `<...>` en un solo recorrido (lineal). Un `<` sin `>` posterior queda como texto. */
function sinEtiquetas(html: string): string {
  const partes: string[] = [];
  let i = 0;
  for (;;) {
    const ini = html.indexOf('<', i);
    if (ini < 0) break;
    const fin = html.indexOf('>', ini + 1);
    if (fin < 0) break; // ya no hay ningún `>`: lo que resta es texto
    partes.push(html.slice(i, ini), ' ');
    i = fin + 1;
  }
  partes.push(html.slice(i));
  return partes.join('');
}

/** Texto plano de un trozo de HTML: sin etiquetas, sin entidades comunes, sin tildes, espacios simples. */
export function plano(html: string): string {
  return sinEtiquetas(html)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&([a-z])(acute|tilde|uml|grave);/gi, '$1')
    .replace(/&amp;/gi, '&')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Minúsculas solo ASCII: conserva la longitud (toLowerCase puede cambiarla) para buscar con índices. */
const minusculas = (s: string): string => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));

/**
 * Trozos `<nombre ...>contenido</cierre>` en orden, con búsqueda por `indexOf` (lineal;
 * sin retroceso de expresiones regulares). `nombres` son las etiquetas de apertura
 * admitidas y `cierres` las de cierre, en minúsculas y sin `<`/`>`.
 */
function trozos(html: string, nombres: readonly string[], cierres: readonly string[]): string[] {
  const bajo = minusculas(html);
  const salida: string[] = [];
  let i = 0;
  for (;;) {
    const ini = bajo.indexOf('<t', i);
    if (ini < 0) break;
    const nombre = nombres.find((n) => bajo.startsWith(n, ini + 1) && /[\s>/]/.test(bajo[ini + 1 + n.length] ?? ''));
    if (!nombre) { i = ini + 2; continue; }
    const finApertura = bajo.indexOf('>', ini);
    if (finApertura < 0) break;
    // cierre más próximo de los admitidos, recorriendo `</t` hacia adelante una sola vez
    let k = finApertura + 1;
    let cierre = -1;
    let largo = 0;
    for (;;) {
      const c = bajo.indexOf('</t', k);
      if (c < 0) break;
      const hallado = cierres.find((x) => bajo.startsWith(`${x}>`, c + 2));
      if (hallado) { cierre = c; largo = hallado.length; break; }
      k = c + 3;
    }
    if (cierre < 0) break; // sin cierre: ninguna etiqueta posterior lo tendrá
    salida.push(html.slice(finApertura + 1, cierre));
    i = cierre + largo + 3;
  }
  return salida;
}

/** Celdas (<td>/<th>) de cada fila (<tr>) de un trozo de HTML, en texto plano. */
export function filasDe(html: string): string[][] {
  return trozos(html, ['tr'], ['tr']).map((fila) => trozos(fila, ['td', 'th'], ['td', 'th']).map(plano));
}

/**
 * Número con coma decimal y punto de miles opcional («1520,00», «1.520,50»)
 * o con punto decimal («12.06», «1542.0000»). Devuelve null si no es un número.
 */
export function numeroDe(texto: string): number | null {
  const t = texto.trim();
  let normal: string;
  if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(t)) normal = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d+$/.test(t)) normal = t.replace(',', '.');
  else if (/^\d+(\.\d+)?$/.test(t)) normal = t;
  else return null;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

/** «4/11/2026» → «2026-11-04»; si no es una fecha de calendario válida, null. */
export function fechaDiaMesAnio(texto: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto.trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  return esFechaIso(iso) ? iso : null;
}

/** ¿Es «aaaa-mm-dd» y una fecha de calendario real? */
export function esFechaIso(x: unknown): x is string {
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const d = new Date(`${x}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === x;
}
