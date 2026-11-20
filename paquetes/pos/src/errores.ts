/** Códigos de error tipados del POS. El mensaje es apto para el usuario; no incluye datos personales. */
export type CodigoErrorPos =
  | 'entrada-invalida'
  | 'no-autorizado'
  | 'dato-corrupto'
  | 'sin-turno'
  | 'turno-ajeno'
  | 'turno-no-abierto'
  | 'turno-ya-abierto'
  | 'request-en-uso'
  | 'precio-alterado'
  | 'producto-inexistente'
  | 'producto-inactivo'
  | 'sin-precio'
  | 'series-invalidas'
  | 'descuento-sin-aprobacion'
  | 'aprobacion-inexistente'
  | 'aprobacion-no-aprobada'
  | 'aprobacion-usada'
  | 'aprobacion-vencida'
  | 'aprobacion-no-coincide'
  | 'autoaprobacion'
  | 'pagos-invalidos'
  | 'medio-no-habilitado'
  | 'conteo-faltante'
  | 'egreso-excede-efectivo'
  | 'venta-inexistente'
  | 'venta-ya-anulada'
  | 'anulacion-sin-solicitud'
  | 'credito-inexistente'
  | 'credito-saldo-insuficiente'
  | 'carritos-abiertos'
  | 'carrito-inexistente'
  | 'carrito-cerrado'
  | 'carrito-ajeno'
  | 'carrito-conflicto'
  | 'limite-carritos';

export class ErrorPos extends Error {
  constructor(
    readonly codigo: CodigoErrorPos,
    mensaje: string,
    /** Datos para quien llama (p. ej. el carrito vigente en un conflicto). El borde los puede reenviar en `details`. */
    readonly detalle?: Readonly<Record<string, unknown>>,
  ) {
    super(mensaje);
    this.name = 'ErrorPos';
  }
}
