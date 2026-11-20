import type { MedioPago, PagoEntrada } from '../../api/tipos.js';
import { centavosATexto, textoACentavos } from '../../util/dinero.js';

export interface FilaPago {
  id: string;
  medio: MedioPago;
  monto: string;
  recibido: string;
  referencia: string;
}

export const NOMBRE_MEDIO: Record<MedioPago, string> = { efectivo: 'Efectivo', qr: 'QR (registro manual)', transferencia: 'Transferencia', credito: 'Crédito' };

/** Cálculo puro de los pagos: restante por cobrar, cambio y errores de captura. */
export function calcularPagos(filas: readonly FilaPago[], total: number, moneda: string): { pagos: PagoEntrada[]; neto: number; restante: number; cambioTotal: number; errores: string[] } {
  const errores: string[] = [];
  const pagos: PagoEntrada[] = [];
  let neto = 0;
  let cambioTotal = 0;
  for (const f of filas) {
    const m = textoACentavos(f.monto);
    if (m === null || m <= 0) {
      errores.push(`${NOMBRE_MEDIO[f.medio]}: escriba un monto mayor a cero.`);
      continue;
    }
    neto += m;
    if (f.medio === 'qr' && f.referencia.trim() === '') errores.push('QR: escriba la referencia que muestra el banco.');
    let monto = m;
    let cambio = 0;
    if (f.medio === 'efectivo' && f.recibido.trim() !== '') {
      const r = textoACentavos(f.recibido);
      if (r === null || r < m) errores.push('Efectivo: lo recibido no puede ser menor al monto.');
      else {
        monto = r;
        cambio = r - m;
      }
    }
    cambioTotal += cambio;
    pagos.push({ medio: f.medio, moneda, monto, ...(cambio > 0 ? { cambio } : {}), ...(f.referencia.trim() !== '' && f.medio !== 'efectivo' ? { referencia: f.referencia.trim() } : {}) });
  }
  return { pagos, neto, restante: total - neto, cambioTotal, errores };
}

/**
 * La última fila cuyo monto la persona no escribió toma lo que falta del total (nunca menos de cero). Si no hay filas sin escribir,
 * no cambia nada. Devuelve la misma lista si no hay cambio, para no provocar otra pasada.
 */
export function montosQueSiguenAlRestante(filas: readonly FilaPago[], editadas: ReadonlySet<string>, total: number): FilaPago[] {
  let i = -1;
  for (let k = filas.length - 1; k >= 0; k--) {
    if (!editadas.has(filas[k]?.id ?? '')) {
      i = k;
      break;
    }
  }
  const fila = filas[i];
  if (fila === undefined) return filas as FilaPago[];
  const otros = filas.reduce((suma, f, k) => (k === i ? suma : suma + (textoACentavos(f.monto) ?? 0)), 0);
  const resto = Math.max(0, total - otros);
  const texto = resto > 0 ? centavosATexto(resto) : '';
  if (texto === fila.monto) return filas as FilaPago[];
  return filas.map((f, k) => (k === i ? { ...f, monto: texto } : f));
}
