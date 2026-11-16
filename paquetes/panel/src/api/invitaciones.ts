import type { ClienteApi } from './cliente.js';
import type { Sesion } from '../sesion/sesion.js';

/**
 * Tras invitar o reenviar con éxito, el panel envía el correo con el enlace para fijar la contraseña (el servidor no envía
 * correos). Pasa por la capa de sesión (`recuperarContrasena`), que responde igual exista o no la cuenta: no se revela nada.
 * El envío nunca hace fallar la acción ya hecha. Devuelve el mismo objeto (el doble expone su estado a las pruebas): solo
 * reemplaza su `llamar`.
 */
export function conCorreoDeInvitacion<T extends ClienteApi>(api: T, sesion: Pick<Sesion, 'recuperarContrasena'>): T {
  const original = (api.llamar as (n: string, e: unknown) => Promise<unknown>).bind(api);
  (api as { llamar: unknown }).llamar = async (nombre: string, entrada: { correo?: unknown }): Promise<unknown> => {
    const salida = await original(nombre, entrada);
    if ((nombre === 'invitarUsuario' || nombre === 'reenviarInvitacion') && typeof entrada.correo === 'string') {
      try {
        await sesion.recuperarContrasena(entrada.correo);
      } catch {
        // Sin efecto visible: la invitación ya quedó registrada y se puede reenviar.
      }
    }
    return salida;
  };
  return api;
}
