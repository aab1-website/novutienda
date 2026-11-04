import type { MedioPago, Moneda, PagoEntrada } from '../api/tipos.js';
import { textoACentavos } from './dinero.js';

export interface FilaPago {
  id: string;
  medio: MedioPago;
  monto: string;
  recibido: string;
  referencia: string;
}

export const NOMBRE_MEDIO: Record<MedioPago, string> = { efectivo: 'Efectivo', qr: 'QR (registro manual)', transferencia: 'Transferencia', credito: 'Crédito' };

/** Cálculo puro de los pagos: restante por cobrar, cambio y errores de captura. */
export function calcularPagos(filas: readonly FilaPago[], total: number, moneda: Moneda): { pagos: PagoEntrada[]; neto: number; restante: number; cambioTotal: number; errores: string[] } {
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

