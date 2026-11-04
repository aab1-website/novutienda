// `EjecutorRecibos` directamente sobre Firestore. A diferencia del adaptador genérico sobre `BaseDatosIdentidad`
// (que emula `actualizar` con `set` y por eso exige leer antes), aquí `actualizar` es `update` nativo: modifica
// solo los campos pedidos de un documento que debe existir. Lo necesita `enviarRecibo`, que actualiza el estado
// del envío en una transacción distinta de la lectura.
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import type { EjecutorRecibos, TransaccionRecibos } from '@plataforma/recibos';

type Datos = Readonly<Record<string, unknown>>;

const limpiar = (d: Datos): Record<string, unknown> => Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined));

export function crearEjecutorRecibos(firestore: Firestore): EjecutorRecibos {
  return {
    transaccion: (fn) =>
      firestore.runTransaction((tx) => {
        const adaptada: TransaccionRecibos = {
          leer: async (ruta) => (await tx.get(firestore.doc(ruta))).data(),
          existe: async (ruta) => (await tx.get(firestore.doc(ruta))).exists,
          set: (ruta, datos) => {
            tx.set(firestore.doc(ruta), limpiar(datos));
          },
          create: (ruta, datos) => {
            tx.create(firestore.doc(ruta), limpiar(datos));
          },
          actualizar: (ruta, parcial) => {
            tx.update(firestore.doc(ruta), limpiar(parcial));
          },
          nuevoId: (coleccion) => firestore.collection(coleccion).doc().id,
          marcaTiempoServidor: () => FieldValue.serverTimestamp(),
        };
        return fn(adaptada);
      }),
  };
}
