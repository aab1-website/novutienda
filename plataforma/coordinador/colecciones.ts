// Lectura de colecciones completas. `BaseDatosIdentidad` solo lee documentos por ruta; listar una
// colección (productos, eventos) es una consulta que cada entorno implementa: Firestore en producción
// y el doble de base de datos en las pruebas.

export interface DocumentoListado {
  readonly id: string;
  readonly datos: Readonly<Record<string, unknown>>;
}

export interface LectorColecciones {
  /** Documentos directos de la colección (`tenants/{t}/productos`), en orden de inserción. */
  listar(rutaColeccion: string): Promise<readonly DocumentoListado[]>;
}
