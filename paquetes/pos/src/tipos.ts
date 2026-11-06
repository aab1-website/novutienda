import type { CopiaCotizacion, Mercado, Moneda } from '@novutienda/nucleo';

export type MedioPago = 'efectivo' | 'qr' | 'transferencia' | 'credito';
export const MEDIOS_PAGO: readonly MedioPago[] = ['efectivo', 'qr', 'transferencia', 'credito'];
export const MONEDAS_POS: readonly Moneda[] = ['BOB', 'USD', 'ARS'];
export const ALMACENES_POS: readonly string[] = ['tienda', 'deposito-1', 'deposito-2'];
/** El plan contrata una sola caja activa por turno. */
export const CAJA_UNICA = 'caja-1';

/** Quien opera: su rol sale del claim ya verificado por el borde (callable). El tipo es del núcleo (`ActorConRol`, T1); aquí conserva su nombre. */
export type { ActorConRol as ActorPos } from '@novutienda/nucleo';

/** Montos en centavos enteros. */
export interface TotalesMoneda {
  /** Efectivo neto de cambio de ventas y cobros de crédito, menos reembolsos en efectivo. */
  readonly efectivo: number;
  readonly qr: number;
  readonly transferencia: number;
  /** Crédito otorgado neto de anulaciones. */
  readonly credito: number;
  readonly ingresos: number;
  readonly egresos: number;
}

export type TotalesTurno = Readonly<Partial<Record<Moneda, TotalesMoneda>>>;
export type MontosPorMoneda = Readonly<Partial<Record<Moneda, number>>>;

export type EstadoTurno = 'abierto' | 'cerrado' | 'cerrado_forzado';

export interface TurnoPos {
  readonly turnoId: string;
  readonly cajaId: string;
  readonly cajeroUid: string;
  readonly estado: EstadoTurno;
  readonly apertura: MontosPorMoneda;
  readonly totales: TotalesTurno;
  readonly abiertoEnMs: number;
  readonly cerradoEnMs?: number;
  readonly cerradoPor?: string;
  readonly motivoCierre?: string;
  readonly contado?: MontosPorMoneda;
  readonly esperado?: MontosPorMoneda;
  readonly diferencia?: MontosPorMoneda;
}

export interface LineaVenta {
  readonly productoId: string;
  /** Copia del nombre del producto al momento de la venta. */
  readonly nombre: string;
  readonly cantidad: number;
  readonly precioUnitario: number;
  readonly almacenId: string;
  readonly series: readonly string[];
  readonly garantiaMeses?: number;
}

export interface PagoVentaPos {
  readonly medio: MedioPago;
  readonly moneda: Moneda;
  readonly monto: number;
  readonly cambio?: number;
  readonly referencia?: string;
  /** Solo QR: quien registró la referencia a mano. Nunca se marca como verificado. */
  readonly registradoPor?: string;
}

export interface DescuentoVentaPos {
  readonly monto: number;
  readonly motivo: string;
  readonly aprobadoPor?: string;
  readonly aprobacionId?: string;
}

export interface VentaPos {
  readonly ventaId: string;
  readonly turnoId: string;
  readonly cajaId: string;
  readonly cajeroUid: string;
  readonly estado: 'confirmada' | 'anulada';
  readonly moneda: Moneda;
  readonly mercado: Mercado;
  readonly cotizacion: CopiaCotizacion | null;
  readonly lineas: readonly LineaVenta[];
  readonly subtotal: number;
  readonly descuento?: DescuentoVentaPos;
  readonly total: number;
  readonly pagos: readonly PagoVentaPos[];
  readonly cliente?: { readonly nombre: string; readonly telefono?: string };
  readonly serie: string;
  readonly receiptNo: number;
  readonly creadoEnMs: number;
  readonly solicitudAnulacion?: { readonly por: string; readonly motivo: string; readonly enMs: number };
}

/** Texto para mostrar un pago: el QR manual dice «registrado por», nunca «verificado». */
export function etiquetaPago(p: PagoVentaPos): string {
  if (p.medio === 'qr') return `QR registrado por ${p.registradoPor ?? 'desconocido'}`;
  return p.medio;
}
