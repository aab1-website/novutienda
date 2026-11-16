import { ErrorApi } from './errores.js';
import type { ClienteApi } from './cliente.js';
import type { Sesion } from '../sesion/sesion.js';

/**
 * Tras invitar o reenviar con éxito, el panel envía el correo con el enlace para fijar la contraseña (el servidor no envía
 * correos). Pasa por la capa de sesión (`enviarEnlaceDeAcceso`), que responde igual exista o no la cuenta: no se revela nada.
 * Si el envío falla, lanza `correo-no-enviado` (la acción del servidor ya se hizo y se puede reenviar). Devuelve el mismo objeto (el doble expone su estado a las pruebas): solo
 * reemplaza su `llamar`.
 */
export function conCorreoDeInvitacion<T extends ClienteApi>(api: T, sesion: Pick<Sesion, 'enviarEnlaceDeAcceso'>): T {
  const original = (api.llamar as (n: string, e: unknown) => Promise<unknown>).bind(api);
  (api as { llamar: unknown }).llamar = async (nombre: string, entrada: { correo?: unknown }): Promise<unknown> => {
    const salida = await original(nombre, entrada); // si el servidor falla, no se envía nada
    if ((nombre === 'invitarUsuario' || nombre === 'reenviarInvitacion') && typeof entrada.correo === 'string') {
      let enviado: boolean;
      try {
        enviado = await sesion.enviarEnlaceDeAcceso(entrada.correo);
      } catch {
        enviado = false;
      }
      // La invitación ya quedó registrada: el administrador lo ve y usa «Reenviar». No se dice «Invitación enviada».
      if (!enviado) throw new ErrorApi('unavailable', 'No se pudo enviar el correo.', { codigo: 'correo-no-enviado' });
    }
    return salida;
  };
  return api;
}
