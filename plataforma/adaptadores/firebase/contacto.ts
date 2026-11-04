// `GuardarContacto` del sitio sobre `tenants/{t}/contactos/{operacionId}`. El id es la clave de idempotencia
// que eligió el navegador: reenviar el mismo formulario no crea un segundo documento.
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import type { GuardarContacto } from '@novutienda/website';

const YA_EXISTE = 6; // código gRPC ALREADY_EXISTS

export function crearGuardarContacto(firestore: Firestore, tenantId: string): GuardarContacto {
  return {
    async guardar(c, recibidoEn) {
      try {
        await firestore.doc(`tenants/${tenantId}/contactos/${c.operacionId}`).create({
          nombre: c.nombre,
          correo: c.correo,
          telefono: c.telefono,
          mensaje: c.mensaje,
          pais: c.pais,
          productoId: c.productoId,
          recibidoEnMs: recibidoEn,
          creadoEn: FieldValue.serverTimestamp(),
        });
        return 'creado';
      } catch (error) {
        if ((error as { code?: unknown }).code === YA_EXISTE) return 'repetido';
        throw error;
      }
    },
  };
}
