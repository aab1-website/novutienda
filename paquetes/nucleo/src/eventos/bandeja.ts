import { validarEvento } from './contratos.js';
import type { SobreEvento } from '../contratos/sobre-evento.js';

/** Transacción mínima inyectable para la bandeja (la adapta firebase-admin en el borde). */
export interface TransaccionBandeja {
  /** Crea el documento; falla si ya existe. No hay `set`, `update` ni `delete`. */
  create(ruta: string, datos: Readonly<Record<string, unknown>>): void;
  existe(ruta: string): Promise<boolean>;
  /** Marca de tiempo asignada por el servidor al confirmar. */
  marcaTiempoServidor(): unknown;
}

/** Ejecutor de transacciones inyectable. */
export interface EjecutorTransacciones<T extends TransaccionBandeja = TransaccionBandeja> {
  transaccion<R>(fn: (tx: T) => Promise<R>): Promise<R>;
}

export class ErrorEvento extends Error {}

const SEGURO = /^[A-Za-z0-9._-]+$/;
function segmento(valor: string, nombre: string): string {
  if (!SEGURO.test(valor)) throw new ErrorEvento(`${nombre} contiene caracteres no permitidos`);
  return valor;
}

export const rutaEvento = (tenantId: string, id: string): string =>
  `tenants/${segmento(tenantId, 'tenantId')}/eventos/${segmento(id, 'id')}`;

export const rutaProcesado = (tenantId: string, consumidor: string, id: string): string =>
  `tenants/${segmento(tenantId, 'tenantId')}/procesados/${segmento(consumidor, 'consumidor')}_${segmento(id, 'id')}`;

/** Publica el evento en la bandeja de salida dentro de la transacción del negocio. */
export function publicarEvento(tx: TransaccionBandeja, evento: SobreEvento): void {
  const v = validarEvento(evento);
  if (!v.ok) throw new ErrorEvento(v.error);
  tx.create(rutaEvento(evento.tenantId, evento.id), { ...evento, publicadoEn: tx.marcaTiempoServidor() });
}

/**
 * Procesa el evento una sola vez por consumidor: el registro del procesado y los
 * efectos del manejador ocurren en la misma transacción. Devuelve `false` si era duplicado.
 */
export async function consumir<T extends TransaccionBandeja>(
  ejecutor: EjecutorTransacciones<T>,
  opciones: { consumidor: string; evento: SobreEvento; manejador: (tx: T, evento: SobreEvento) => Promise<void> },
): Promise<boolean> {
  const { consumidor, evento, manejador } = opciones;
  const v = validarEvento(evento);
  if (!v.ok) throw new ErrorEvento(v.error);
  const ruta = rutaProcesado(evento.tenantId, consumidor, evento.id);
  return ejecutor.transaccion(async (tx) => {
    if (await tx.existe(ruta)) return false;
    await manejador(tx, evento);
    tx.create(ruta, { consumidor, eventoId: evento.id, tipo: evento.tipo, procesadoEn: tx.marcaTiempoServidor() });
    return true;
  });
}
