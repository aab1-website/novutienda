import type { BaseDatosIdentidad, TransaccionIdentidad } from '@novutienda/nucleo';

type Datos = Readonly<Record<string, unknown>>;

/**
 * Doble de base de datos con transacciones serializables (control optimista):
 * cada lectura registra la versión del documento; al confirmar, si alguna
 * cambió, se descarta y se reintenta, como hace Firestore ante contención.
 * Ofrece además borrado y las operaciones de auditoría (`create`, `nuevoId`).
 */
export class DobleDb implements BaseDatosIdentidad {
  readonly docs = new Map<string, { datos: Datos | undefined; version: number }>();
  reintentos = 0;
  private secuencia = 0;

  poner(ruta: string, datos: Datos | undefined): void {
    this.docs.set(ruta, { datos, version: (this.docs.get(ruta)?.version ?? 0) + 1 });
  }

  dato(ruta: string): Datos | undefined {
    return this.docs.get(ruta)?.datos;
  }

  /** Documentos de una colección (por prefijo de ruta), en orden de inserción. */
  coleccion(prefijo: string): Datos[] {
    return [...this.docs]
      .filter(([r, d]) => r.startsWith(`${prefijo}/`) && d.datos !== undefined)
      .map(([, d]) => d.datos as Datos);
  }

  async runTransaction<T>(fn: (tx: TransaccionIdentidad) => Promise<T>): Promise<T> {
    for (;;) {
      const lecturas = new Map<string, number>();
      const escrituras = new Map<string, Datos | undefined>();
      const tx: TransaccionIdentidad = {
        get: async (ruta) => {
          await Promise.resolve(); // cede el turno para forzar intercalado
          const d = this.docs.get(ruta);
          lecturas.set(ruta, d?.version ?? 0);
          return { existe: d?.datos !== undefined, data: () => d?.datos };
        },
        set: (ruta, datos) => {
          escrituras.set(ruta, datos);
        },
        delete: (ruta) => {
          escrituras.set(ruta, undefined);
        },
        create: (ruta, datos) => {
          escrituras.set(ruta, datos);
        },
        nuevoId: () => `aud${String((this.secuencia += 1))}`,
        marcaTiempoServidor: () => 'MARCA',
      };
      const resultado = await fn(tx);
      const conflicto = [...lecturas].some(([r, v]) => (this.docs.get(r)?.version ?? 0) !== v);
      if (conflicto) {
        this.reintentos += 1;
        continue;
      }
      for (const [r, d] of escrituras) this.poner(r, d);
      return resultado;
    }
  }
}
