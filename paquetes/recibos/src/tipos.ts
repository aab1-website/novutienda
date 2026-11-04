import type { CopiaCotizacion, EjecutorTransacciones, Rol, TransaccionAuditoria, TransaccionBandeja } from '@plataforma/nucleo';

export type Datos = Readonly<Record<string, unknown>>;

/**
 * Transacción mínima que necesita el módulo (la adapta firebase-admin en el borde).
 * Incluye la bandeja de eventos y la auditoría del núcleo; `set` y `actualizar`
 * solo se usan sobre documentos propios del módulo (contador y comprobantes).
 */
export interface TransaccionRecibos extends TransaccionBandeja, TransaccionAuditoria {
  /** Lee un documento; `undefined` si no existe. */
  leer(ruta: string): Promise<Datos | undefined>;
  /** Escribe el documento completo (solo el contador de numeración). */
  set(ruta: string, datos: Datos): void;
  /** Actualiza campos de un documento existente. */
  actualizar(ruta: string, parcial: Datos): void;
}

export type EjecutorRecibos = EjecutorTransacciones<TransaccionRecibos>;

export type EstadoRecibo = 'EMITIDO' | 'ANULADO';

/** Estados del envío por WhatsApp; ninguno afirma un envío que no ocurrió. */
export type EstadoEnvio = 'no_enviado' | 'sin_telefono' | 'enlace_generado' | 'enviado' | 'fallido';

export interface DatosNegocio {
  readonly nombre: string;
  readonly direccion?: string;
  readonly telefono?: string;
  readonly nit?: string;
}

/** Plantilla del tenant: `tenants/{t}/plantillas_recibo/main`. */
export interface PlantillaRecibo {
  /** Serie de la numeración (A-Z, 0-9, hasta 6 caracteres). */
  readonly serie: string;
  /** URL https del logo. */
  readonly logoUrl?: string;
  readonly negocio: DatosNegocio;
  readonly pie?: string;
  readonly politicaGarantia?: string;
  readonly politicaCambios?: string;
}

export interface LineaRecibo {
  readonly productoId: string;
  /** Nombre del producto al momento de la venta (copia del evento). */
  readonly nombre: string;
  readonly cantidad: number;
  readonly precioUnitario: number;
  readonly subtotal: number;
  readonly series: readonly string[];
  readonly garantiaMeses?: number;
  /** Fecha aaaa-mm-dd hasta la que rige la garantía. */
  readonly garantiaHasta?: string;
}

/** Pago resumido: sin referencias ni importes recibidos o cambio. */
export interface PagoRecibo {
  readonly medio: string;
  readonly moneda: string;
  readonly monto: number;
}

export interface AnulacionRecibo {
  readonly motivo: string;
  readonly anuladaPor: string;
  readonly aprobadoPor: string;
  readonly anuladoEn: string;
}

/** Comprobante no fiscal: `tenants/{t}/recibos/recibo-{ventaId}`. */
export interface Recibo {
  readonly reciboId: string;
  readonly tenantId: string;
  readonly ventaId: string;
  /** Número legible: serie y correlativo con ceros (A-000123). */
  readonly numero: string;
  readonly serie: string;
  readonly correlativo: number;
  readonly estado: EstadoRecibo;
  /** Fecha aaaa-mm-dd de emisión, en la zona horaria del tenant. */
  readonly fecha: string;
  readonly emitidoEn: string;
  readonly moneda: string;
  readonly total: number;
  readonly descuento?: { readonly monto: number; readonly motivo: string };
  readonly cotizacion: CopiaCotizacion | null;
  readonly lineas: readonly LineaRecibo[];
  readonly pagos: readonly PagoRecibo[];
  /** Referencia a la factura fiscal externa (SUMA); solo referencial. */
  readonly facturaSuma?: string;
  /** Datos personales mínimos, solo si la venta los trae. */
  readonly cliente?: { readonly nombre: string; readonly telefono?: string };
  /** Copia de la plantilla vigente al emitir. */
  readonly plantilla: PlantillaRecibo;
  readonly envioWhatsapp: { readonly estado: EstadoEnvio; readonly actualizadoEn?: string };
  readonly anulacion?: AnulacionRecibo;
}

export interface ActorAuditado {
  readonly uid: string;
  readonly rol: Rol;
}
