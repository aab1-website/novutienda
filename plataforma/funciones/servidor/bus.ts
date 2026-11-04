// Bus de eventos real. Los módulos publican en `tenants/{t}/eventos/{id}` DENTRO de la transacción del negocio;
// este disparador entrega cada evento a los consumidores de Recibos e Inventarios. `consumir` (núcleo) es
// idempotente por id y por clave, así que la entrega «al menos una vez» de Functions es segura. Con `retry`
// activo, Functions reintenta lo que falle; el tope lo pone `consumir` (5 intentos fallidos por consumidor y
// evento, luego queda «descartado» y deja de reintentarse), de modo que un evento venenoso no gira para siempre.
import { logger } from 'firebase-functions';
import { validarEvento, type SobreEvento } from '@novutienda/nucleo';
import { consumidoresDePlataforma, type Consumidor } from '../../adaptadores/index.js';
import type { Entorno } from './entorno.js';

export interface ResultadoBus {
  readonly entregas: number;
  readonly aplicadas: number;
  readonly sinConsumidor: boolean;
}

/**
 * El documento guardado lleva `publicadoEn` (marca del servidor): no es parte del sobre. Se valida el CONTRATO completo
 * (sobre, tipo, versión y datos): un evento fuera de contrato se descarta y se registra, nunca llega a un consumidor ni
 * se relanza (reintentarlo no lo arreglaría y con `retry` giraría).
 */
export function sobreDesdeDocumento(datos: Readonly<Record<string, unknown>>): SobreEvento | undefined {
  const { publicadoEn: _p, ...sobre } = datos;
  void _p;
  const v = validarEvento(sobre);
  return v.ok ? v.valor : undefined;
}

export function consumidoresDe(e: Entorno): readonly Consumidor[] {
  return consumidoresDePlataforma(e.db, { ahora: () => new Date(e.ahora()).toISOString() });
}

/**
 * Entrega un evento publicado a los consumidores que lo piden. Si alguno falla, relanza el primer error DESPUÉS
 * de intentarlos todos: los que ya terminaron quedan registrados como procesados y no se repiten.
 */
export async function entregarEvento(e: Entorno, tenantIdRuta: string, eventoIdRuta: string, datos: Readonly<Record<string, unknown>>): Promise<ResultadoBus> {
  const evento = sobreDesdeDocumento(datos);
  if (evento === undefined) {
    logger.error('evento fuera de contrato en la bandeja: descartado', { tenantId: tenantIdRuta, eventoId: eventoIdRuta });
    return { entregas: 0, aplicadas: 0, sinConsumidor: false };
  }
  if (evento.tenantId !== tenantIdRuta || evento.id !== eventoIdRuta) {
    logger.error('evento que no coincide con su ruta', { tenantId: tenantIdRuta, eventoId: eventoIdRuta });
    return { entregas: 0, aplicadas: 0, sinConsumidor: false };
  }
  const aptos = consumidoresDe(e).filter((c) => c.tipos.includes(evento.tipo));
  if (aptos.length === 0) return { entregas: 0, aplicadas: 0, sinConsumidor: true };
  let aplicadas = 0;
  let primerError: unknown;
  for (const consumidor of aptos) {
    try {
      if (await consumidor.manejar(evento)) aplicadas += 1;
    } catch (error) {
      primerError ??= error;
      logger.warn('consumidor de eventos con error', { consumidor: consumidor.nombre, tipo: evento.tipo, eventoId: evento.id, error: error instanceof Error ? error.name : 'desconocido' });
    }
  }
  if (primerError !== undefined) throw primerError;
  return { entregas: aptos.length, aplicadas, sinConsumidor: false };
}
