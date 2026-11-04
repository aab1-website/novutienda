/** Códigos de error de la consola. El mensaje es apto para el usuario; el detalle técnico va al registro. */
export type CodigoErrorConsola =
  | 'no-autorizado'
  | 'entrada-invalida'
  | 'no-encontrado'
  | 'conflicto'
  | 'limite'
  | 'cuota-excedida'
  | 'tipo-no-permitido'
  | 'estado'
  | 'contador-corrupto'
  | 'procesamiento'
  | 'no-disponible';

export class ErrorConsola extends Error {
  constructor(
    readonly codigo: CodigoErrorConsola,
    mensaje: string,
    readonly detalles: readonly string[] = [],
  ) {
    super(mensaje);
    this.name = 'ErrorConsola';
  }
}
