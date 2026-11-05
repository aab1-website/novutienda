import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AlmacenCotizaciones, Documento, TransaccionCotizaciones } from './nucleo-tc.js';

export const fixture = (nombre: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${nombre}`, import.meta.url)), 'utf8');

/** 4/11/2026 10:00 en La Paz y en Buenos Aires. */
export const AHORA = Date.parse('2026-11-04T14:00:00Z');

/** Almacén en memoria con la semántica de `crear` (falla si existe) y registro de escrituras. */
export class AlmacenMemoria implements AlmacenCotizaciones {
  readonly docs = new Map<string, Documento>();
  async leer(ruta: string): Promise<Documento | null> {
    return this.docs.get(ruta) ?? null;
  }
  async transaccion<T>(fn: (tx: TransaccionCotizaciones) => Promise<T>): Promise<T> {
    const pendientes: (() => void)[] = [];
    const tx: TransaccionCotizaciones = {
      leer: (r) => this.leer(r),
      establecer: (r, d) => { pendientes.push(() => void this.docs.set(r, d)); },
      crear: (r, d) => {
        pendientes.push(() => {
          if (this.docs.has(r)) throw new Error(`ya existe ${r}`);
          this.docs.set(r, d);
        });
      },
    };
    const resultado = await fn(tx);
    pendientes.forEach((p) => p());
    return resultado;
  }
}
