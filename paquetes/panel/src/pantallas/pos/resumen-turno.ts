import type { FilaTurnoVista, ResumenMonedaVista, ResumenTurnoVista, TurnoPos, VentaPos } from '../../api/tipos.js';
import { monedasDelTurno } from './arqueo.js';

// Resumen del turno que calcula el doble del panel. Vive en la pantalla (no en `doble/`) para que una prueba de fuera lo alcance por
// `@novutienda/panel/pos` sin que la interfaz importe el doble.
const sinMedios = (): { efectivo: number; qr: number; transferencia: number; credito: number } => ({ efectivo: 0, qr: 0, transferencia: 0, credito: 0 });

export function filaTurnoDe(t: TurnoPos): FilaTurnoVista {
  return {
    turnoId: t.turnoId, cajaId: t.cajaId, cajeroUid: t.cajeroUid, estado: t.estado, abiertoEnMs: t.abiertoEnMs,
    ...(t.cerradoEnMs !== undefined ? { cerradoEnMs: t.cerradoEnMs } : {}), apertura: t.apertura, totales: t.totales,
  };
}

/** Resumen del turno del doble, sin estado: una prueba (`pruebas/pos`) lo compara con `resumirTurno` del módulo. */
export function resumirTurnoDoble(
  t: TurnoPos,
  ventas: Iterable<VentaPos>,
  anulaciones: readonly { readonly turnoIdReembolso: string; readonly moneda: string; readonly reembolsos: readonly { medio: 'efectivo' | 'qr' | 'transferencia'; monto: number }[]; readonly creditoCancelado: number }[],
  monedasCaja: Parameters<typeof monedasDelTurno>[1],
): ResumenTurnoVista {
  const acc = new Map<string, { ventas: number; bruto: number; dCant: number; dMonto: number; neto: number; anCant: number; anMonto: number; reemb: ReturnType<typeof sinMedios> }>();
  const de = (m: string): NonNullable<ReturnType<typeof acc.get>> => {
    let x = acc.get(m);
    if (x === undefined) {
      x = { ventas: 0, bruto: 0, dCant: 0, dMonto: 0, neto: 0, anCant: 0, anMonto: 0, reemb: sinMedios() };
      acc.set(m, x);
    }
    return x;
  };
  for (const v of ventas) {
    if (v.turnoId !== t.turnoId) continue;
    const x = de(v.moneda);
    if (v.estado === 'anulada') {
      x.anCant += 1;
      x.anMonto += v.total;
      continue;
    }
    x.ventas += 1;
    x.bruto += v.subtotal;
    x.neto += v.total;
    const d = v.descuento?.monto ?? 0;
    if (d > 0) {
      x.dCant += 1;
      x.dMonto += d;
    }
  }
  for (const a of anulaciones) {
    if (a.turnoIdReembolso !== t.turnoId) continue;
    const x = de(a.moneda);
    for (const r of a.reembolsos) x.reemb[r.medio] += r.monto;
    x.reemb.credito += a.creditoCancelado;
  }
  const monedas = monedasDelTurno({ apertura: {}, totales: t.totales }, monedasCaja);
  const todas = [...monedas, ...[...acc.keys()].filter((m) => !monedas.includes(m)).sort()];
  const porMoneda: Record<string, ResumenMonedaVista> = {};
  for (const m of todas) {
    const x = de(m);
    const tm = t.totales[m];
    porMoneda[m] = {
      ventas: x.ventas, bruto: x.bruto, descuentos: { cantidad: x.dCant, monto: x.dMonto }, neto: x.neto,
      porMedio: { efectivo: tm?.efectivo ?? 0, qr: tm?.qr ?? 0, transferencia: tm?.transferencia ?? 0, credito: tm?.credito ?? 0 },
      anuladas: { cantidad: x.anCant, monto: x.anMonto }, reembolsos: x.reemb, ingresos: tm?.ingresos ?? 0, egresos: tm?.egresos ?? 0,
    };
  }
  return { turno: filaTurnoDe(t), monedas: todas, porMoneda, truncado: false };
}
