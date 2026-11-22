// `AlmacenCotizaciones` del núcleo sobre la misma base transaccional de la plataforma: así la
// cotización que el POS lee dentro de su transacción es la que escribieron `escribirCotizacion` y
// `cargarManual` (y `leerCotizacion` produce la misma copia en ambos lados).
import type { Firestore } from 'firebase-admin/firestore';
import type { AlmacenCotizaciones, BaseDatosIdentidad, Documento } from '@novutienda/nucleo';

export function almacenCotizacionesDesde(db: BaseDatosIdentidad & { readonly firestore?: Pick<Firestore, 'collection'> }): AlmacenCotizaciones {
  const leerDoc = (tx: { get(r: string): Promise<{ existe: boolean; data(): Documento | undefined }> }, ruta: string): Promise<Documento | null> =>
    tx.get(ruta).then((d) => (d.existe ? (d.data() ?? null) : null));
  return {
    leer: (ruta) => db.runTransaction((tx) => leerDoc(tx, ruta)),
    // Historial (subcolección): del más nuevo al más viejo por `actualizadoEn` (ISO: el orden de texto es el cronológico).
    // Sin `firestore` en la base (dobles de memoria) no hay listado y quien lo usa recibe el historial vacío.
    ...(db.firestore === undefined
      ? {}
      : {
          listarRecientes: async (ruta: string, limite: number): Promise<readonly Documento[]> => {
            const snap = await db.firestore!.collection(ruta).orderBy('actualizadoEn', 'desc').limit(limite).get();
            return snap.docs.map((d) => d.data());
          },
        }),
    transaccion: (fn) =>
      db.runTransaction((tx) =>
        fn({
          leer: (ruta) => leerDoc(tx, ruta),
          establecer: (ruta, datos) => {
            tx.set(ruta, datos);
          },
          crear: (ruta, datos) => {
            tx.create(ruta, datos);
          },
        }),
      ),
  };
}
