import type { EstadoMerma, MermaVista, ProductoPanel } from '../../api/tipos.js';
import { MAX_CANTIDAD, separar, TEXTO_EXISTENCIAS_OCULTAS } from './movimientos-resumen.js';
import { nombreAlmacen } from './nombres.js';

export const ESTADO_TEXTO: Readonly<Record<EstadoMerma, string>> = { solicitada: 'Pendiente', aprobada: 'Aprobada', rechazada: 'Rechazada' };

export type FiltroEstado = '' | EstadoMerma;
export const OPCIONES_ESTADO: readonly { valor: FiltroEstado; texto: string }[] = [
  { valor: 'solicitada', texto: 'Pendientes' }, { valor: 'aprobada', texto: 'Aprobadas' }, { valor: 'rechazada', texto: 'Rechazadas' }, { valor: '', texto: 'Todas' },
];

/** Pendientes primero y, dentro de cada grupo, lo más reciente arriba. */
export function ordenarMermas(mermas: readonly MermaVista[]): MermaVista[] {
  return [...mermas].sort((a, b) => Number(b.estado === 'solicitada') - Number(a.estado === 'solicitada') || b.fecha.localeCompare(a.fecha));
}

export interface BorradorMerma {
  productoId: string;
  ubicacionId: string;
  cantidad: string;
  series: string;
  motivo: string;
}

export const MERMA_INICIAL: BorradorMerma = { productoId: '', ubicacionId: 'tienda', cantidad: '1', series: '', motivo: '' };

export const MOTIVO_MAX = 500;

/** Errores por campo de la solicitud (vacío si se puede enviar). */
export function revisarSolicitud(b: BorradorMerma, p: ProductoPanel | undefined): Record<string, string> {
  const e: Record<string, string> = {};
  if (p === undefined) e['producto'] = 'Elija un producto.';
  if (p?.conSerie === true) {
    const s = separar(b.series);
    if (s.length === 0) e['series'] = 'Escriba al menos una serie.';
    else if (new Set(s).size !== s.length) e['series'] = 'Hay series repetidas.';
  } else {
    const t = b.cantidad.trim();
    if (!/^\d+$/.test(t) || Number(t) < 1) e['cantidad'] = 'Escriba una cantidad entera mayor que 0.';
    else if (Number(t) > MAX_CANTIDAD) e['cantidad'] = `El máximo es ${String(MAX_CANTIDAD)}.`;
    else {
      // Con la existencia oculta (null) no se compara: valida el servidor.
      const hay = p !== undefined && b.ubicacionId in p.existencias ? p.existencias[b.ubicacionId as keyof ProductoPanel['existencias']] : null;
      if (hay !== null && Number(t) > hay) e['cantidad'] = `En ${nombreAlmacen(b.ubicacionId)} hay ${String(hay)}: no se puede dar de baja más.`;
    }
  }
  if (b.motivo.trim() === '') e['motivo'] = 'Escriba el motivo de la merma.';
  return e;
}

export const MOTIVO_RECHAZO_FALTA = 'Escriba por qué rechaza la merma.';

/** Líneas del diálogo al aprobar: qué se da de baja y cuánto quedará. Vista previa: el stock lo mueve solo el servidor. */
export function resumenResolucion(m: MermaVista, p: ProductoPanel | undefined, decision: 'aprobada' | 'rechazada'): string[] {
  const nombre = p?.nombre ?? m.productoId;
  const series = m.series.length > 0 ? ` (${m.series.join(', ')})` : '';
  const base = [`${String(m.cantidad)} × ${nombre}${series} en ${nombreAlmacen(m.ubicacionId)}.`, `Motivo de la solicitud: ${m.motivo}`];
  if (decision === 'rechazada') return [...base, 'El stock no cambia.'];
  const hay = p?.existencias[m.ubicacionId];
  return [...base, ...(hay === undefined ? [] : hay === null ? [TEXTO_EXISTENCIAS_OCULTAS] : [`Hay ${String(hay)}, quedarán ${String(hay - m.cantidad)}.`]), 'Se descuenta del stock y no se deshace desde aquí.'];
}
