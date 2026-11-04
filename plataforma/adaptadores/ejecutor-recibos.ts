// Adaptador de Recibos sobre la misma base que usan los demás módulos: convierte una
// `BaseDatosIdentidad` en el `EjecutorRecibos` que piden `manejarVentaConfirmada` y `manejarVentaAnulada`.
import type { BaseDatosIdentidad } from '@plataforma/nucleo';
import type { EjecutorRecibos, TransaccionRecibos } from '@plataforma/recibos';

type Datos = Readonly<Record<string, unknown>>;

/**
 * `actualizar` mezcla sobre el documento leído antes en la misma transacción (Firestore no admite
 * lecturas después de escrituras, así que la lectura previa es obligatoria).
 */
export function ejecutorRecibosDesde(db: BaseDatosIdentidad): EjecutorRecibos {
  return {
    transaccion: (fn) =>
      db.runTransaction((tx) => {
        const leidos = new Map<string, Datos | undefined>();
        const leer = async (ruta: string): Promise<Datos | undefined> => {
          const d = await tx.get(ruta);
          const v = d.existe ? d.data() : undefined;
          leidos.set(ruta, v);
          return v;
        };
        const adaptada: TransaccionRecibos = {
          leer,
          existe: async (ruta) => (await leer(ruta)) !== undefined,
          set: (ruta, datos) => {
            tx.set(ruta, datos);
          },
          create: (ruta, datos) => {
            tx.create(ruta, datos);
          },
          actualizar: (ruta, parcial) => {
            const previo = leidos.get(ruta);
            if (previo === undefined) throw new Error(`actualizar exige leer antes un documento existente: ${ruta}`);
            tx.set(ruta, { ...previo, ...parcial });
          },
          nuevoId: (coleccion) => tx.nuevoId(coleccion),
          marcaTiempoServidor: () => tx.marcaTiempoServidor(),
        };
        return fn(adaptada);
      }),
  };
}
