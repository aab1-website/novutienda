import type { MovimientoCaja } from './caja.js';
import { etiquetaPago, type VentaPos } from './tipos.js';

/** Importe generado por el sistema, en centavos: se emite como decimal sin neutralizar el signo. */
export interface CeldaMonto {
  readonly centavos: number;
}

export type CeldaCsv = string | number | boolean | CeldaMonto | null | undefined;

/**
 * Neutraliza una celda de texto para que una hoja de cálculo no la interprete como fórmula: si empieza
 * con = + - @ (o tabulación o retorno de carro) se antepone una comilla simple. Luego aplica el
 * entrecomillado CSV. Los números generados por el sistema no pasan por la neutralización.
 */
export function celdaCsv(valor: CeldaCsv): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'object') return formatoMonto(valor.centavos);
  if (typeof valor === 'number') return String(valor);
  if (typeof valor === 'boolean') return valor ? 'true' : 'false';
  let t = valor;
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\n\r]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
}

/** Texto CSV con saltos de línea CRLF. */
export function aCsv(encabezados: readonly string[], filas: readonly (readonly CeldaCsv[])[]): string {
  return [encabezados, ...filas].map((f) => f.map(celdaCsv).join(',')).join('\r\n') + '\r\n';
}

/** Centavos enteros a texto decimal («12345» → «123.45», «-500» → «-5.00»), como texto para no tocar el signo. */
export function formatoMonto(centavos: number): string {
  const signo = centavos < 0 ? '-' : '';
  const a = Math.abs(centavos);
  return `${signo}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

const monto = (centavos: number): CeldaMonto => ({ centavos });

export function csvVentas(ventas: readonly VentaPos[]): string {
  return aCsv(
    ['recibo', 'serie', 'ventaId', 'turnoId', 'cajero', 'estado', 'moneda', 'subtotal', 'descuento', 'motivoDescuento', 'total', 'pagos', 'cliente', 'fechaMs'],
    ventas.map((v) => [
      v.receiptNo,
      v.serie,
      v.ventaId,
      v.turnoId,
      v.cajeroUid,
      v.estado,
      v.moneda,
      monto(v.subtotal),
      monto(v.descuento?.monto ?? 0),
      v.descuento?.motivo,
      monto(v.total),
      v.pagos.map((p) => `${etiquetaPago(p)} ${formatoMonto(p.monto - (p.cambio ?? 0))}${p.referencia !== undefined ? ` ref ${p.referencia}` : ''}`).join(' | '),
      v.cliente?.nombre,
      v.creadoEnMs,
    ]),
  );
}

export function csvMovimientosCaja(movs: readonly MovimientoCaja[]): string {
  return aCsv(
    ['requestId', 'turnoId', 'tipo', 'moneda', 'monto', 'motivo', 'comprobante', 'registradoPor', 'fechaMs'],
    movs.map((m) => [m.requestId, m.turnoId, m.tipo, m.moneda, monto(m.monto), m.motivo, m.comprobante, m.registradoPor, m.creadoEnMs]),
  );
}
