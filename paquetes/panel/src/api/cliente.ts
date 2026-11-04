import type { Entrada, NombreCallable, Salida } from './contrato.js';

/**
 * Cliente tipado de los callables. `llamar` agrega `tenantId` en el transporte; la implementación real usa
 * `httpsCallable` de Firebase Functions (`firebase.ts`) y el doble en memoria (`doble/`) sirve para desarrollo y pruebas.
 * Toda falla se lanza como `ErrorApi`.
 */
export interface ClienteApi {
  llamar<N extends NombreCallable>(nombre: N, entrada: Entrada<N>): Promise<Salida<N>>;
}

/** Identificador aleatorio (UUID v4) para `requestId`, `operacionId` y similares. */
export function nuevoId(): string {
  return crypto.randomUUID();
}
