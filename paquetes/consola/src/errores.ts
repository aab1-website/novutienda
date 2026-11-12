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

/**
 * Lo lanza un `ProcesadorMedios` cuando el procesamiento no está disponible por una causa ajena al archivo (el servicio de
 * video no responde, no está desplegado, etc.). La subida se rechaza con el código `no-disponible` y el archivo no se culpa.
 */
export class ProcesamientoNoDisponible extends Error {
  constructor(mensaje = 'Procesamiento no disponible') {
    super(mensaje);
    this.name = 'ProcesamientoNoDisponible';
  }
}

/**
 * Lo lanza un `ProcesadorMedios` cuando el archivo en sí no es admisible (por ejemplo, un formato de video no soportado).
 * Su mensaje es legible para el usuario y la subida se rechaza mostrándolo tal cual, con el código `tipo-no-permitido`.
 */
export class ArchivoNoAdmitido extends Error {
  constructor(mensaje = 'Archivo no admitido') {
    super(mensaje);
    this.name = 'ArchivoNoAdmitido';
  }
}

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
