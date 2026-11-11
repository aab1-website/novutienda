// Guardia del registro de tokens de NovuChat: solo un tenant que existe y está operativo (`activo`) puede recibir un token nuevo.
// Lógica pura: la lectura llega por inyección. Los mensajes no llevan identificadores.
import { esEstadoTenant, esTenantIdValido, tenantOperativo } from '@novutienda/nucleo';

export type LeerDocumento = (ruta: string) => Promise<{ readonly existe: boolean; data(): Readonly<Record<string, unknown>> | undefined }>;

/** Lanza si el tenant no es válido, no existe, no tiene estado válido o no está `activo`. */
export async function exigirTenantOperativo(tenantId: string, leer: LeerDocumento): Promise<void> {
  if (!esTenantIdValido(tenantId)) throw new Error('el tenant no es un identificador válido');
  const doc = await leer(`tenants/${tenantId}`);
  if (!doc.existe) throw new Error('el tenant no existe');
  const estado = doc.data()?.['estado'];
  if (!esEstadoTenant(estado)) throw new Error('el tenant no tiene un estado válido: corra el alta antes');
  if (!tenantOperativo({ estado })) throw new Error('el tenant no está activo: no se registran tokens');
}
