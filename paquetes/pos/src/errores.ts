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
  | 'credito-saldo-insuficiente';

export class ErrorPos extends Error {
  constructor(
    readonly codigo: CodigoErrorPos,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = 'ErrorPos';
  }
}
