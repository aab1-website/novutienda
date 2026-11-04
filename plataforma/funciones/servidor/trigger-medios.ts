// Disparador de Storage: al terminar de subirse un original (`tenants/{t}/privado/originales/{producto}/{subida}`)
// finaliza la subida (valida bytes, procesa, publica versiones). Actúa con el rol VIGENTE de quien subió: se
// toma de sus claims actuales en Auth, así que un usuario degradado o deshabilitado no completa subidas.
import { logger } from 'firebase-functions';
import { finalizarSubida } from '@plataforma/consola';
import { esTenantIdValido } from '@plataforma/nucleo';
import type { Entorno } from './entorno.js';
import { depsMedios } from './llamadas/medios.js';

const RUTA_ORIGINAL = /^tenants\/([a-z0-9][a-z0-9-]{0,62})\/privado\/originales\/([a-z0-9][a-z0-9-]{1,59})\/([A-Za-z0-9_-]{8,40})$/;

export type ResultadoSubida = 'ignorada' | 'sin-reserva' | 'sin-usuario' | 'finalizada' | 'rechazada';

export async function procesarObjetoSubido(e: Entorno, bucket: string, nombre: string): Promise<ResultadoSubida> {
  const m = RUTA_ORIGINAL.exec(nombre);
  if (m === null || bucket !== e.bucket.name) return 'ignorada';
  const [, tenantId, productoId, subidaId] = m;
  if (!esTenantIdValido(tenantId) || subidaId === undefined || productoId === undefined) return 'ignorada';
  const reserva = (await e.firestore.doc(`tenants/${tenantId}/subidas/${subidaId}`).get()).data();
  if (reserva?.['estado'] !== 'reservada' || reserva['productoId'] !== productoId || typeof reserva['por'] !== 'string') return 'sin-reserva';
  let usuario;
  try {
    usuario = await e.auth.getUser(reserva['por']);
  } catch {
    return 'sin-usuario';
  }
  if (usuario.disabled || !usuario.emailVerified) return 'sin-usuario';
  const actor = { uid: usuario.uid, claims: { ...(usuario.customClaims ?? {}), firebase: { sign_in_provider: 'password' } } };
  try {
    await finalizarSubida(depsMedios({ e }), { tenantId, actor, subidaId });
    return 'finalizada';
  } catch (error) {
    // finalizarSubida ya liberó la reserva y borró lo subido cuando el archivo no cumple; no se reintenta.
    logger.warn('subida rechazada', { tenantId, subidaId, error: error instanceof Error ? error.name : 'desconocido', mensaje: error instanceof Error ? error.message : '' });
    return 'rechazada';
  }
}
