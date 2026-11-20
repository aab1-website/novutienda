import { ErrorApi } from './errores.js';
import type { ClienteApi } from './cliente.js';
import type { Entrada, Salida } from './contrato.js';
import type { Sesion } from '../sesion/sesion.js';

/** Fases del alta: el registro en el servidor y el envío del correo con el enlace. */
export type FaseInvitacion = 'registrando' | 'enviando';

/** Opciones de una llamada de invitación (solo existen en el cliente que envuelve `conCorreoDeInvitacion`). */
export interface OpcionesInvitacion {
  /** Cambiar el rol de una invitación ya enviada: no se vuelve a enviar el correo. */
  readonly sinCorreo?: boolean;
  /** Avisa en qué fase está la llamada (para mostrar «Registrando…» y «Enviando el correo…»). */
  readonly alFase?: (fase: FaseInvitacion) => void;
}

/** Llama a una acción de invitación con sus opciones; sin el envoltorio de correo, las opciones se ignoran. */
export function llamarInvitacion<N extends 'invitarUsuario' | 'reenviarInvitacion'>(api: ClienteApi, nombre: N, entrada: Entrada<N>, opciones: OpcionesInvitacion = {}): Promise<Salida<N>> {
  return (api.llamar as (n: string, e: unknown, o: OpcionesInvitacion) => Promise<Salida<N>>)(nombre, entrada, opciones);
}

/**
 * Tras invitar o reenviar con éxito, el panel envía el correo con el enlace para fijar la contraseña (el servidor no envía
 * correos). Pasa por la capa de sesión (`enviarEnlaceDeAcceso`), que responde igual exista o no la cuenta: no se revela nada.
 * Si el envío falla, lanza `correo-no-enviado` (la acción del servidor ya se hizo y se puede reenviar). Devuelve el mismo objeto (el doble expone su estado a las pruebas): solo
 * reemplaza su `llamar`.
 */
export function conCorreoDeInvitacion<T extends ClienteApi>(api: T, sesion: Pick<Sesion, 'enviarEnlaceDeAcceso'>): T {
  const original = (api.llamar as (n: string, e: unknown) => Promise<unknown>).bind(api);
  (api as { llamar: unknown }).llamar = async (nombre: string, entrada: { correo?: unknown }, opciones?: OpcionesInvitacion): Promise<unknown> => {
    const esInvitacion = nombre === 'invitarUsuario' || nombre === 'reenviarInvitacion';
    if (esInvitacion) opciones?.alFase?.('registrando');
    const salida = await original(nombre, entrada); // si el servidor falla, no se envía nada
    if (esInvitacion && opciones?.sinCorreo !== true && typeof entrada.correo === 'string') {
      opciones?.alFase?.('enviando');
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
