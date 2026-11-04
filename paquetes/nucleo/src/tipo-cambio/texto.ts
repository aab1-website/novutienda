/** Utilidades de texto compartidas por los parsers (puras). */

/** Texto plano de un trozo de HTML: sin etiquetas, sin entidades comunes, sin tildes, espacios simples. */
export function plano(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&([a-z])(acute|tilde|uml|grave);/gi, '$1')
    .replace(/&amp;/gi, '&')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Celdas (<td>) de cada fila (<tr>) de un trozo de HTML, en texto plano. */
export function filasDe(html: string): string[][] {
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((f) =>
    [...f[1]!.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => plano(c[1]!)),
  );
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
