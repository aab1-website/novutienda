// `Notificador` real del tipo de cambio. Por ahora: un documento `tenants/{t}/alertas/{id}` (visible para el
// panel) y un registro estructurado de severidad ERROR que una alerta de Cloud Monitoring basada en
// registros puede vigilar (ver docs/produccion/alertas.md). No envía correos ni mensajes por sí mismo.
import { logger } from 'firebase-functions';
import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import type { AvisoOperativo, Notificador } from '@novutienda/nucleo';

const YA_EXISTE = 6;

export function crearNotificador(firestore: Firestore, tenantId: string, ahora: () => number): Notificador {
  return {
    async notificar(aviso: AvisoOperativo) {
      const iso = new Date(ahora()).toISOString();
      // Campo `alerta` fijo: el filtro del registro es jsonPayload.alerta="cotizacion".
      logger.error('alerta de cotización', {
        alerta: 'cotizacion', tipo: aviso.tipo, mercado: aviso.mercado, detalle: aviso.detalle, fallas: aviso.fallas ?? [], tenantId,
      });
      // Un documento por tipo, mercado y hora: tres corridas al día no llenan la colección con repetidos.
      const id = `${aviso.tipo}-${aviso.mercado}-${iso.slice(0, 13).replace('T', '-')}`;
      try {
        await firestore.doc(`tenants/${tenantId}/alertas/${id}`).create({
          tipo: aviso.tipo, mercado: aviso.mercado, detalle: aviso.detalle, fallas: aviso.fallas ?? [], creadaEn: iso, creadaEnServidor: FieldValue.serverTimestamp(),
          atendida: false,
        });
      } catch (error) {
        if ((error as { code?: unknown }).code !== YA_EXISTE) throw error;
      }
    },
  };
}
