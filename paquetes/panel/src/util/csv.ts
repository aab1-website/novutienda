export type CeldaCsv = string | number | boolean | null | undefined;

/** Neutraliza celdas que una hoja de cálculo leería como fórmula (= + - @, tab, retorno) y aplica el entrecomillado CSV. */
export function celdaCsv(v: CeldaCsv, separador = ','): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  const t = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return t.includes(separador) || /["\n\r]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
}

/** `separador` por defecto es la coma (CSV de importación); una celda que lo contiene va entre comillas. */
export function aCsv(encabezados: readonly string[], filas: readonly (readonly CeldaCsv[])[], opciones?: { readonly separador?: string }): string {
  const sep = opciones?.separador ?? ',';
  return [encabezados, ...filas].map((f) => f.map((c) => celdaCsv(c, sep)).join(sep)).join('\r\n') + '\r\n';
}

/** Descarga un texto como archivo desde el navegador (Blob; sin enlaces externos). */
export function descargarTexto(nombre: string, contenido: string, tipo = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob(['﻿', contenido], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
