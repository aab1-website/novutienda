export class ErrorRecibo extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = new.target.name;
  }
}

/** No existe el comprobante pedido (por ejemplo, al enviar o referenciar un recibo inexistente). */
export class ReciboNoEncontrado extends ErrorRecibo {}

export class PlantillaInvalida extends ErrorRecibo {}

export class AccionNoPermitida extends ErrorRecibo {}
