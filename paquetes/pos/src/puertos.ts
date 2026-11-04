import type { Mercado, TransaccionIdentidad } from '@plataforma/nucleo';

/**
 * Plan de salida de stock preparado por Inventarios (solo lecturas). Para el POS es opaco:
 * lo produce `prepararSalida` y lo consume `aplicarSalida`.
 */
export type PlanSalida = unknown;

/** Plan de reversión de una salida (anulación). Opaco para el POS. */
export type PlanReversion = unknown;

export interface LineaSalida {
  readonly productoId: string;
  readonly cantidad: number;
  readonly almacenId: string;
  readonly series?: readonly string[];
}

export interface ReferenciaMovimiento {
  readonly tipo: 'venta' | 'pedido';
  readonly id: string;
}

export interface QuienMueve {
  readonly uid: string;
  readonly rol: string;
}

/**
 * Puerto de Inventarios que consume el POS. Inventarios implementa estas mismas firmas.
 * Todo ocurre dentro de la transacción recibida: primero las preparaciones (solo lecturas) y
 * después las aplicaciones (solo escrituras). Las preparaciones lanzan `StockInsuficiente`,
 * `SerieNoDisponible` o `ProductoInactivo`, que abortan toda la operación.
 */
export interface PuertoInventarios {
  prepararSalida(tx: TransaccionIdentidad, tenantId: string, lineas: readonly LineaSalida[]): Promise<PlanSalida>;
  aplicarSalida(tx: TransaccionIdentidad, plan: PlanSalida, ref: ReferenciaMovimiento, por: QuienMueve): void;
  prepararReversion(tx: TransaccionIdentidad, tenantId: string, ref: ReferenciaMovimiento): Promise<PlanReversion>;
  aplicarReversion(tx: TransaccionIdentidad, plan: PlanReversion, ref: ReferenciaMovimiento, por: QuienMueve): void;
}

/** Lo que el POS necesita de un producto para vender (lectura). */
export interface ProductoCatalogo {
  readonly productoId: string;
  /** Nombre vigente; la venta guarda una copia al momento de vender. */
  readonly nombre: string;
  readonly activo: boolean;
  /** Precio base en USD por mercado (el precio final lo calcula el POS con la cotización). */
  readonly preciosUsd: Readonly<Partial<Record<Mercado, number>>>;
  readonly controlaSeries: boolean;
  readonly garantiaMeses?: number;
}

/**
 * Lectura del catálogo (Inventarios es el dueño de los productos). Puerto adicional al de
 * stock: el coordinador lo cablea con la API pública de Inventarios.
 */
export interface PuertoCatalogo {
  leerProducto(tx: TransaccionIdentidad, tenantId: string, productoId: string): Promise<ProductoCatalogo | null>;
}
