/** Fecha de calendario en La Paz (UTC-4) como aaaa-mm-dd. */
export function fechaLaPaz(ms: number): string {
  return new Date(ms - 4 * 3_600_000).toISOString().slice(0, 10);
}

/** Resta meses de calendario; si el día no existe en el mes destino, queda el último día de ese mes. */
export function restarMeses(fecha: string, meses: number): string {
  const [a = 0, m = 1, d = 1] = fecha.split('-').map(Number);
  const total = a * 12 + (m - 1) - meses;
  const anio = Math.floor(total / 12);
  const mes = total % 12;
  const ultimo = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  return `${String(anio).padStart(4, '0')}-${String(mes + 1).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
}

/** Último mes por defecto: desde hace un mes hasta hoy (calendario de La Paz). */
export function rangoUltimoMes(ahoraMs: number): { desde: string; hasta: string } {
  const hasta = fechaLaPaz(ahoraMs);
  return { desde: restarMeses(hasta, 1), hasta };
}

/** Días de calendario que abarca el rango, contando ambos extremos. */
export function diasDelRango(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000) + 1;
}

/** El servidor de POS acepta hasta 366 días por exportación. */
export const MAX_DIAS_EXPORTACION = 366;

/** Mensaje de error del rango (o `null` si es válido). */
export function validarRango(desde: string, hasta: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) return 'Indique las fechas Desde y Hasta.';
  if (desde > hasta) return 'La fecha Desde no puede ser posterior a Hasta.';
  if (diasDelRango(desde, hasta) > MAX_DIAS_EXPORTACION) return `El rango puede abarcar hasta ${MAX_DIAS_EXPORTACION} días. Acórtelo.`;
  return null;
}
