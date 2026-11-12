import {
  consumir,
  type BaseDatosIdentidad,
  type EjecutorTransacciones,
  type SobreEvento,
  type TransaccionBandeja,
  type TransaccionIdentidad,
} from '@novutienda/nucleo';
import { anotarCambio, leerEstadoSitio } from './cambios.js';

/** Nombre con el que la consola queda registrada como consumidora en la bandeja de procesados. */
export const CONSUMIDOR_CONSOLA = 'consola';

/** Transacción con lo que necesitan a la vez el estado del sitio y la bandeja de eventos. */
export type TransaccionConsola = TransaccionIdentidad & TransaccionBandeja;

/** Adapta una base de datos de identidad al ejecutor que pide `consumir` (la bandeja del núcleo). */
export function ejecutorConsola(db: BaseDatosIdentidad): EjecutorTransacciones<TransaccionConsola> {
  return {
    transaccion: (fn) =>
      db.runTransaction((tx) =>
        fn({
          get: (r) => tx.get(r),
          set: (r, d) => {
            tx.set(r, d);
          },
          delete: (r) => {
            tx.delete(r);
          },
          create: (r, d) => {
            tx.create(r, d);
          },
          nuevoId: (c) => tx.nuevoId(c),
          marcaTiempoServidor: () => tx.marcaTiempoServidor(),
          existe: async (r) => (await tx.get(r)).existe,
        }),
      ),
  };
}

/**
 * Consume `producto.cambiado` (v1): anota un cambio sin publicar en `sitio/estado`, igual que `anotarCambio`. Una sola vez
 * por evento (por id y por clave de idempotencia, en la misma transacción que el contador). `consumir` valida el evento con
 * el contrato del núcleo y lanza `ErrorEvento` si es inválido. Devuelve `false` si era duplicado o estaba descartado.
 *
 * Única vía de conteo de los cambios de producto: los callables de consola (alta, edición, precio, importación) llaman a la
 * biblioteca de Inventarios por el puerto, que publica el evento en la misma transacción; consola ya no anota esos cambios.
 */
export function consumirProductoCambiado(
  ejecutor: EjecutorTransacciones<TransaccionConsola>,
  evento: SobreEvento,
): Promise<boolean> {
  return consumir(ejecutor, {
    consumidor: CONSUMIDOR_CONSOLA,
    evento,
    manejador: async (tx, ev) => {
      const estado = await leerEstadoSitio(tx, ev.tenantId);
      anotarCambio(tx, ev.tenantId, estado, ev.ocurridoEn);
    },
  });
}
