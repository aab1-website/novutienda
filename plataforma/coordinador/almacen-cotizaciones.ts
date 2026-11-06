// `AlmacenCotizaciones` del núcleo sobre la misma base transaccional de la plataforma: así la
// cotización que el POS lee dentro de su transacción es la que escribieron `escribirCotizacion` y
// `cargarManual` (y `leerCotizacion` produce la misma copia en ambos lados).
import type { AlmacenCotizaciones, BaseDatosIdentidad, Documento } from '@novutienda/nucleo';

export function almacenCotizacionesDesde(db: BaseDatosIdentidad): AlmacenCotizaciones {
  const leerDoc = (tx: { get(r: string): Promise<{ existe: boolean; data(): Documento | undefined }> }, ruta: string): Promise<Documento | null> =>
    tx.get(ruta).then((d) => (d.existe ? (d.data() ?? null) : null));
  return {
    leer: (ruta) => db.runTransaction((tx) => leerDoc(tx, ruta)),
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
