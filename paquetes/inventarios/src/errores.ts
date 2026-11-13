/** Códigos con la semántica de los callables (`HttpsError`); el adaptador del borde los traduce tal cual. */
export type CodigoError =
  | 'invalid-argument'
  | 'failed-precondition'
  | 'already-exists'
  | 'not-found'
  | 'permission-denied';

export class ErrorInventario extends Error {
  constructor(
    readonly codigo: CodigoError,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = 'ErrorInventario';
  }
}

/** Entrada que no cumple el formato: se rechaza, nunca se corrige. */
export class EntradaInvalida extends ErrorInventario {
  constructor(
    mensaje: string,
    readonly detalles: readonly string[] = [],
  ) {
    super('invalid-argument', mensaje);
    this.name = 'EntradaInvalida';
  }
}

export interface Faltante {
  readonly productoId: string;
  readonly almacenId: string;
  readonly pedido: number;
  readonly disponible: number;
}

/** En mostrador no se vende lo que no hay. Lista todos los faltantes de la operación. */
export class StockInsuficiente extends ErrorInventario {
  constructor(readonly faltantes: readonly Faltante[]) {
    super('failed-precondition', `Stock insuficiente: ${faltantes.map((f) => `${f.productoId}@${f.almacenId}`).join(', ')}`);
    this.name = 'StockInsuficiente';
  }
}

/**
 * Traspaso rechazado porque el origen o el destino tiene un conteo abierto y quien opera no es `adm`. Se lanza ANTES de toda
 * validación que dependa de cantidades; el mensaje no lleva cantidades ni productos. El nombre (`ConteoAbierto`) fija el código
 * `conteo-abierto` del borde.
 */
export class TraspasoBloqueadoPorConteo extends ErrorInventario {
  constructor(
    readonly ubicacionId: string,
    readonly conteoId: string,
    readonly abiertoEn: string | null,
  ) {
    super('failed-precondition', `No se puede traspasar desde ni hacia ${ubicacionId} mientras tiene un conteo abierto.`);
    this.name = 'ConteoAbierto';
  }
}

/** La serie no existe, no está disponible o está en otro almacén: la segunda venta de una serie falla aquí. */
export class SerieNoDisponible extends ErrorInventario {
  constructor(
    readonly productoId: string,
    readonly serie: string,
  ) {
    super('failed-precondition', `Serie no disponible: ${productoId}/${serie}`);
    this.name = 'SerieNoDisponible';
  }
}

export class ProductoInactivo extends ErrorInventario {
  constructor(
    readonly productoId: string,
    readonly motivo: 'inactivo' | 'inexistente',
  ) {
    super('failed-precondition', `Producto ${motivo}: ${productoId}`);
    this.name = 'ProductoInactivo';
  }
}

/** Misma operacionId con otro contenido. */
export class OperacionConflicto extends ErrorInventario {
  constructor(readonly operacionId: string) {
    super('already-exists', `La operación ${operacionId} ya existe con otro contenido`);
    this.name = 'OperacionConflicto';
  }
}

export class SinPermiso extends ErrorInventario {
  constructor(mensaje: string) {
    super('permission-denied', mensaje);
    this.name = 'SinPermiso';
  }
}

export class NoEncontrado extends ErrorInventario {
  constructor(mensaje: string) {
    super('not-found', mensaje);
    this.name = 'NoEncontrado';
  }
}

/** Estado que no admite la operación (merma ya resuelta, conteo cerrado, límite del plan...). */
export class EstadoInvalido extends ErrorInventario {
  constructor(mensaje: string) {
    super('failed-precondition', mensaje);
    this.name = 'EstadoInvalido';
  }
}
