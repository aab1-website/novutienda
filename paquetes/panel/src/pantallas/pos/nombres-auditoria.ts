// Nombres legibles de las acciones que POS y Recibos dejan en la auditoría. El código técnico (`pos.venta.confirmar`)
// es el valor que entiende el servidor, que lo compara por IGUALDAD EXACTA; el nombre es solo para mostrar.

export interface AccionAuditoria {
  readonly codigo: string;
  readonly nombre: string;
}

export const ACCIONES_AUDITORIA: readonly AccionAuditoria[] = [
  { codigo: 'pos.turno.abrir', nombre: 'Apertura de turno' },
  { codigo: 'pos.turno.cerrar', nombre: 'Cierre de turno' },
  { codigo: 'pos.turno.cerrar_forzado', nombre: 'Cierre forzado de turno' },
  { codigo: 'pos.venta.confirmar', nombre: 'Venta confirmada' },
  { codigo: 'pos.anulacion.solicitar', nombre: 'Anulación solicitada' },
  { codigo: 'pos.anulacion.aprobar', nombre: 'Anulación aprobada' },
  { codigo: 'pos.aprobacion.solicitar', nombre: 'Aprobación solicitada' },
  { codigo: 'pos.aprobacion.aprobar', nombre: 'Aprobación concedida' },
  { codigo: 'pos.aprobacion.rechazar', nombre: 'Aprobación rechazada' },
  { codigo: 'pos.caja.ingreso', nombre: 'Ingreso de caja' },
  { codigo: 'pos.caja.egreso', nombre: 'Egreso de caja' },
  { codigo: 'pos.credito.cobrar', nombre: 'Cobro de crédito' },
  { codigo: 'pos.config.guardar', nombre: 'Configuración de ventas guardada' },
  { codigo: 'recibos.emitir', nombre: 'Recibo emitido' },
  { codigo: 'recibos.anular', nombre: 'Recibo anulado' },
  { codigo: 'recibos.anulacion-pendiente', nombre: 'Anulación de recibo pendiente' },
  { codigo: 'recibos.enviar', nombre: 'Recibo enviado al cliente' },
  { codigo: 'recibos.factura-suma', nombre: 'Factura referenciada en un recibo' },
  { codigo: 'recibos.plantilla.guardar', nombre: 'Plantilla de recibos guardada' },
];

const POR_CODIGO: ReadonlyMap<string, string> = new Map(ACCIONES_AUDITORIA.map((a) => [a.codigo, a.nombre]));

/** Nombre legible de una acción; si no se conoce (una acción nueva), el código tal cual. */
export const nombreDeAccion = (codigo: string): string => POR_CODIGO.get(codigo) ?? codigo;
