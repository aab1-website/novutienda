import type { Entrada, NombreCallable, Salida } from './contrato.js';

/**
 * Cliente tipado de los callables. `llamar` agrega `tenantId` en el transporte; la implementación real usa
 * `httpsCallable` de Firebase Functions (`firebase.ts`) y el doble en memoria (`doble/`) sirve para desarrollo y pruebas.
 * Toda falla se lanza como `ErrorApi`.
 *
 * Tercer argumento opcional en tiempo de ejecución: `conCorreoDeInvitacion` (`invitaciones.ts`) acepta `{ sinCorreo, alFase }` en
 * `invitarUsuario` y `reenviarInvitacion` (se usa con `llamarInvitacion`). No es parte del contrato con el servidor, y todo
 * envoltorio de `llamar` que se agregue encima debe reenviarlo o se pierde sin aviso.
 */
export interface ClienteApi {
  llamar<N extends NombreCallable>(nombre: N, entrada: Entrada<N>): Promise<Salida<N>>;
}

/** Identificador aleatorio (UUID v4) para `requestId`, `operacionId` y similares. */
export function nuevoId(): string {
  return crypto.randomUUID();
}
