import { esTenantIdValido } from '@plataforma/nucleo';
import { ErrorRecibo } from './errores.js';

const SEGURO = /^[A-Za-z0-9._-]+$/;
const RESERVADO = /^(\.{1,2}|__.*__)$/;

function segmento(valor: string, nombre: string): string {
  if (!SEGURO.test(valor) || RESERVADO.test(valor)) throw new ErrorRecibo(`${nombre} contiene caracteres no permitidos`);
  return valor;
}

function base(tenantId: string): string {
  if (!esTenantIdValido(tenantId)) throw new ErrorRecibo('tenantId inválido');
  return `tenants/${tenantId}`;
}

/** Id determinista del comprobante de una venta. */
export const reciboIdDe = (ventaId: string): string => `recibo-${segmento(ventaId, 'ventaId')}`;

export const rutaRecibo = (tenantId: string, reciboId: string): string =>
  `${base(tenantId)}/recibos/${segmento(reciboId, 'reciboId')}`;

export const rutaPlantilla = (tenantId: string): string => `${base(tenantId)}/plantillas_recibo/main`;

/** Anulación recibida antes que la venta: se guarda aquí hasta que llegue `venta.confirmada`. */
export const rutaAnulacionPendiente = (tenantId: string, ventaId: string): string =>
  `${base(tenantId)}/anulaciones_pendientes_recibo/${segmento(ventaId, 'ventaId')}`;
