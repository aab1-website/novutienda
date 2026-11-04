/* eslint-disable no-restricted-imports -- provisional: importación profunda hasta que el coordinador cablee el index de nucleo; luego pasar a '@plataforma/nucleo' */
import type { BaseDatosMin, TransaccionMin } from '../../paquetes/nucleo/src/limites/transaccion.js';

type Datos = Readonly<Record<string, unknown>>;

/**
 * Doble de base de datos con transacciones serializables (control optimista):
 * cada lectura registra la versión del documento; al confirmar, si alguna
 * cambió, se descarta y se reintenta, como hace Firestore ante contención.
 */
export class DobleDb implements BaseDatosMin {
  readonly docs = new Map<string, { datos: Datos; version: number }>();
  reintentos = 0;

  poner(ruta: string, datos: Datos): void {
    this.docs.set(ruta, { datos, version: (this.docs.get(ruta)?.version ?? 0) + 1 });
  }

  dato(ruta: string): Datos | undefined {
    return this.docs.get(ruta)?.datos;
  }

  async runTransaction<T>(fn: (tx: TransaccionMin) => Promise<T>): Promise<T> {
    for (;;) {
      const lecturas = new Map<string, number>();
      const escrituras = new Map<string, Datos>();
      const tx: TransaccionMin = {
        get: async (ruta) => {
          await Promise.resolve(); // cede el turno para forzar intercalado
          const d = this.docs.get(ruta);
          lecturas.set(ruta, d?.version ?? 0);
          return { existe: d !== undefined, data: () => d?.datos };
        },
        set: (ruta, datos) => {
          escrituras.set(ruta, datos);
        },
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
