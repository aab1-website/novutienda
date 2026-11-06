// Consumidores de producción del bus: los que la plataforma suscribe a los eventos de Recibos e Inventarios.
// El bus real (`servidor/bus.ts`) y las pruebas de integración usan esta misma lista.
import { consumirPedidoConfirmado, consumirVentaAnulada, ejecutorDesde } from '@novutienda/inventarios';
import type { BaseDatosIdentidad, SobreEvento } from '@novutienda/nucleo';
import { manejarVentaAnulada, manejarVentaConfirmada, type OpcionesEmision } from '@novutienda/recibos';
import { ejecutorRecibosDesde } from './ejecutor-recibos.js';

export interface Consumidor {
  /** Nombre para el informe (no es el nombre del consumidor de la bandeja). */
  readonly nombre: string;
  readonly tipos: readonly string[];
  /** Devuelve `false` si el evento era duplicado o quedó descartado. Lanza si falla (el bus reintenta). */
  manejar(evento: SobreEvento): Promise<boolean>;
}

/** Los consumidores reales de la plataforma: Recibos (2) e Inventarios (2). */
export function consumidoresDePlataforma(db: BaseDatosIdentidad, opcionesRecibos: OpcionesEmision = {}): Consumidor[] {
  const recibos = ejecutorRecibosDesde(db);
  const inventarios = ejecutorDesde(db);
  return [
    { nombre: 'recibos:venta.confirmada', tipos: ['venta.confirmada'], manejar: (e) => manejarVentaConfirmada(recibos, e, opcionesRecibos) },
    { nombre: 'recibos:venta.anulada', tipos: ['venta.anulada'], manejar: (e) => manejarVentaAnulada(recibos, e, opcionesRecibos) },
    { nombre: 'inventarios:venta.anulada', tipos: ['venta.anulada'], manejar: (e) => consumirVentaAnulada(inventarios, e) },
    { nombre: 'inventarios:pedido.confirmado', tipos: ['pedido.confirmado'], manejar: (e) => consumirPedidoConfirmado(inventarios, e) },
  ];
}
