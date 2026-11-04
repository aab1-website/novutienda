/** Documento leído dentro de una transacción. */
export interface DocLeido {
  readonly existe: boolean;
  data(): Readonly<Record<string, unknown>> | undefined;
}

/**
 * Interfaz mínima de transacción de base de datos, por ruta de documento
 * (por ejemplo `tenants/{t}/contadores/uso`). El adaptador de Firestore la
 * implementa sobre `Transaction`; las pruebas, con un doble serializable.
 */
export interface TransaccionMin {
  get(ruta: string): Promise<DocLeido>;
  set(ruta: string, datos: Readonly<Record<string, unknown>>): void;
}

export interface BaseDatosMin {
  /** Ejecuta `fn` de forma atómica y serializable (reintenta ante conflicto). */
  runTransaction<T>(fn: (tx: TransaccionMin) => Promise<T>): Promise<T>;
}
