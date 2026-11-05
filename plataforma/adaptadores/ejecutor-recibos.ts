// Adaptador de Recibos sobre la misma base que usan los demás módulos: convierte una
// `BaseDatosIdentidad` en el `EjecutorRecibos` que piden `manejarVentaConfirmada`, `manejarVentaAnulada` y los
// casos de uso de comprobantes (`enviarRecibo`, `referenciarFacturaSuma`, `guardarPlantilla`).
import type { BaseDatosIdentidad } from '@novutienda/nucleo';
import type { EjecutorRecibos, TransaccionRecibos } from '@novutienda/recibos';

type Datos = Readonly<Record<string, unknown>>;
type Escritura = { readonly tipo: 'set' | 'create'; readonly ruta: string; readonly datos: Datos } | { readonly tipo: 'actualizar'; readonly ruta: string; readonly datos: Datos };

/**
 * Firestore exige todas las lecturas antes de la primera escritura y su `update` no existe en `BaseDatosIdentidad`
 * (solo `set`). Por eso este adaptador DIFIERE las escrituras: durante la transacción solo se lee; al terminar la
 * función se leen (una vez) los documentos que `actualizar` va a mezclar y sin lectura previa, y recién entonces
 * se escribe todo en orden. Así `actualizar` funciona aunque la función no haya leído antes el documento
 * (caso de `enviarRecibo`, que actualiza en una transacción nueva), y se conserva la regla de Firestore de que una
 * lectura no ve las escrituras de su propia transacción. Actualizar un documento inexistente falla.
 */
export function ejecutorRecibosDesde(db: BaseDatosIdentidad): EjecutorRecibos {
  return {
    transaccion: (fn) =>
      db.runTransaction(async (tx) => {
        const leidos = new Map<string, Datos | undefined>();
        const escrituras: Escritura[] = [];
        const leer = async (ruta: string): Promise<Datos | undefined> => {
          const d = await tx.get(ruta);
          const v = d.existe ? d.data() : undefined;
          leidos.set(ruta, v);
          return v;
        };
        const adaptada: TransaccionRecibos = {
          leer,
          existe: async (ruta) => (await leer(ruta)) !== undefined,
          set: (ruta, datos) => void escrituras.push({ tipo: 'set', ruta, datos }),
          create: (ruta, datos) => void escrituras.push({ tipo: 'create', ruta, datos }),
          actualizar: (ruta, parcial) => void escrituras.push({ tipo: 'actualizar', ruta, datos: parcial }),
          nuevoId: (coleccion) => tx.nuevoId(coleccion),
          marcaTiempoServidor: () => tx.marcaTiempoServidor(),
        };
        const resultado = await fn(adaptada);
        // Primero TODAS las lecturas pendientes (un documento que se actualiza y no se leyó, ni se escribió antes en esta transacción).
        const escritos = new Set<string>();
        for (const e of escrituras) {
          if (e.tipo === 'actualizar' && !leidos.has(e.ruta) && !escritos.has(e.ruta)) await leer(e.ruta);
          escritos.add(e.ruta);
        }
        // Después las escrituras, componiendo las actualizaciones sobre el valor vigente de cada documento.
        const vigente = new Map<string, Datos | undefined>(leidos);
        for (const e of escrituras) {
          if (e.tipo === 'actualizar') {
            const previo = vigente.get(e.ruta);
            if (previo === undefined) throw new Error(`actualizar exige un documento existente: ${e.ruta}`);
            const nuevo = { ...previo, ...e.datos };
            vigente.set(e.ruta, nuevo);
            tx.set(e.ruta, nuevo);
          } else {
            vigente.set(e.ruta, e.datos);
            if (e.tipo === 'create') tx.create(e.ruta, e.datos);
            else tx.set(e.ruta, e.datos);
          }
        }
        return resultado;
      }),
  };
}
