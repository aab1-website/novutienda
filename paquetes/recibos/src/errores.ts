export class ErrorRecibo extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = new.target.name;
  }
}

/** La anulación llegó antes que la emisión (o la venta no tiene recibo): el bus debe reintentar. */
export class ReciboNoEncontrado extends ErrorRecibo {}

/** El contador de una serie no es un entero no negativo; nunca se interpreta como cero. */
export class ContadorReciboCorrupto extends ErrorRecibo {}

export class PlantillaInvalida extends ErrorRecibo {}

export class AccionNoPermitida extends ErrorRecibo {}
