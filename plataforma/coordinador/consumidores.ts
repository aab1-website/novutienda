// Consumidores de producción del bus: los que la plataforma suscribe a los eventos de Recibos e Inventarios.
// El bus real (`servidor/bus.ts`) y las pruebas de integración usan esta misma lista.
import { consumirProductoCambiado, ejecutorConsola, type DepsConsumidorProducto } from '@novutienda/consola';
import { consumirPedidoConfirmado, consumirVentaAnulada, ejecutorDesde } from '@novutienda/inventarios';
import type { BaseDatosIdentidad, SobreEvento } from '@novutienda/nucleo';
import { manejarVentaAnulada, manejarVentaConfirmada, type OpcionesEmision } from '@novutienda/recibos';
import { ejecutorRecibosDesde } from './ejecutor-recibos.js';
import type { LectorModulos } from './modulos-activos.js';

export interface Consumidor {
  /** Nombre para el informe (no es el nombre del consumidor de la bandeja). */
  readonly nombre: string;
  readonly tipos: readonly string[];
  /** Devuelve `false` si el evento era duplicado o quedó descartado. Lanza si falla (el bus reintenta). */
  manejar(evento: SobreEvento): Promise<boolean>;
}

/**
 * Los consumidores reales de la plataforma: Recibos (2), Inventarios (2) y la reacción de la consola a `producto.cambiado`.
 *
 * `modulosDelTenant` filtra los consumidores OPCIONALES (los que no están en el `consume` de ningún manifiesto, como
 * `consola:producto.cambiado`): con el módulo apagado no hacen nada y devuelven `false` (evento tratado, sin reintento).
 * Sin lector, el consumidor opcional se trata como encendido.
 *
 * `depsConsola` son las piezas que la consola necesita para el precio vivo (catálogo real, reloj y disparador del sitio): las
 * pone quien compone (el entorno del servidor o el de las pruebas), porque el consumidor no construye puertos.
 */
export function consumidoresDePlataforma(db: BaseDatosIdentidad, opcionesRecibos: OpcionesEmision = {}, modulosDelTenant: LectorModulos | undefined, depsConsola: DepsConsumidorProducto): Consumidor[] {
  const recibos = ejecutorRecibosDesde(db);
  const inventarios = ejecutorDesde(db);
  const consola = ejecutorConsola(db);
  return [
    { nombre: 'recibos:venta.confirmada', tipos: ['venta.confirmada'], manejar: (e) => manejarVentaConfirmada(recibos, e, opcionesRecibos) },
    { nombre: 'recibos:venta.anulada', tipos: ['venta.anulada'], manejar: (e) => manejarVentaAnulada(recibos, e, opcionesRecibos) },
    { nombre: 'inventarios:venta.anulada', tipos: ['venta.anulada'], manejar: (e) => consumirVentaAnulada(inventarios, e) },
    { nombre: 'inventarios:pedido.confirmado', tipos: ['pedido.confirmado'], manejar: (e) => consumirPedidoConfirmado(inventarios, e) },
    {
      nombre: 'consola:producto.cambiado',
      tipos: ['producto.cambiado'],
      manejar: async (e) => {
        if (modulosDelTenant !== undefined && ((await modulosDelTenant(e.tenantId)) ?? []).includes('consola') === false) return false;
        return consumirProductoCambiado(consola, e, depsConsola);
      },
    },
  ];
}
