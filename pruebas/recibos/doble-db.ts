import type { EjecutorRecibos, TransaccionRecibos } from '@novutienda/recibos';

type Datos = Readonly<Record<string, unknown>>;

/**
 * Doble de base de datos con transacciones serializables (control optimista), como el de
 * pruebas/limites: cada lectura registra la versión; al confirmar, si alguna cambió, se
 * descarta y se reintenta. `create` falla si el documento ya existe, como en Firestore.
 */
export class DobleDb implements EjecutorRecibos {
  readonly docs = new Map<string, { datos: Datos | undefined; version: number }>();
  reintentos = 0;
  private secuencia = 0;

  poner(ruta: string, datos: Datos | undefined): void {
    this.docs.set(ruta, { datos, version: (this.docs.get(ruta)?.version ?? 0) + 1 });
  }

  dato(ruta: string): Datos | undefined {
    return this.docs.get(ruta)?.datos;
  }

  coleccion(prefijo: string): Datos[] {
    return [...this.docs]
      .filter(([r, d]) => r.startsWith(`${prefijo}/`) && d.datos !== undefined)
      .map(([, d]) => d.datos as Datos);
  }

  async transaccion<R>(fn: (tx: TransaccionRecibos) => Promise<R>): Promise<R> {
    for (;;) {
      const lecturas = new Map<string, number>();
      const escrituras = new Map<string, Datos>();
      const vigente = (ruta: string): Datos | undefined => (escrituras.has(ruta) ? escrituras.get(ruta) : this.docs.get(ruta)?.datos);
      const leerVersion = async (ruta: string): Promise<void> => {
        await Promise.resolve(); // cede el turno para forzar intercalado
        lecturas.set(ruta, this.docs.get(ruta)?.version ?? 0);
      };
      const tx: TransaccionRecibos = {
        leer: async (ruta) => {
          await leerVersion(ruta);
          return vigente(ruta);
        },
        existe: async (ruta) => {
          await leerVersion(ruta);
          return vigente(ruta) !== undefined;
        },
        set: (ruta, datos) => {
          escrituras.set(ruta, datos);
        },
        create: (ruta, datos) => {
          if (vigente(ruta) !== undefined) throw new Error(`ya existe: ${ruta}`);
          escrituras.set(ruta, datos);
        },
        actualizar: (ruta, parcial) => {
          const previo = vigente(ruta);
          if (previo === undefined) throw new Error(`no existe: ${ruta}`);
          escrituras.set(ruta, { ...previo, ...parcial });
        },
        nuevoId: () => `aud${String((this.secuencia += 1))}`,
        marcaTiempoServidor: () => 'MARCA',
      };
      const resultado = await fn(tx);
      if ([...lecturas].some(([r, v]) => (this.docs.get(r)?.version ?? 0) !== v)) {
        this.reintentos += 1;
        continue;
      }
      for (const [r, d] of escrituras) this.poner(r, d);
      return resultado;
    }
  }
}
