// Tipos congelados del registro de módulos (ola 1a). Sin importaciones.
// Único cambio posterior: `ColeccionManifiesto.ambito`, aditivo y opcional
// (06/11/2026, L1); sin él, todo sigue siendo `tenant`.

/** Roles del claim: cajero, supervisor, administrador, dirección. */
export type Rol = 'caj' | 'sup' | 'adm';

/** Identificador estable de un módulo (por ejemplo `nucleo`). */
export type IdModulo = string;

/** Tipo de evento del sobre (por ejemplo `venta.confirmada`). */
export type TipoEvento = string;

/** Límite de plan que aplica a una colección. */
export type LimiteColeccion = 'productos' | 'usuarios' | 'cajas' | 'almacenes';

export interface ColeccionManifiesto {
  /** Ruta relativa a `tenants/{t}`, por ejemplo `miembros` o `inventario/almacenes`. */
  readonly ruta: string;
  /** Roles que pueden leer. */
  readonly lectura: readonly Rol[];
  /** `servidor` = solo el servidor escribe; si no, los roles que pueden escribir. */
  readonly escritura: 'servidor' | readonly Rol[];
  readonly limite?: LimiteColeccion;
  /**
   * `tenant` (por defecto): la ruta cuelga de `tenants/{t}`. `raiz`: colección
   * fuera de `tenants/{t}`; no tiene tenant del cual sacar un rol, así que solo
   * el servidor la lee y escribe (`lectura: []`, `escritura: 'servidor'`, sin `limite`).
   */
  readonly ambito?: 'tenant' | 'raiz';
}

/** Archivo admitido en una subida reservada. */
export interface ArchivoSubida {
  /** Identificador del tipo de archivo (por ejemplo `original`). */
  readonly tipo: string;
  readonly bytesMax: number;
  /** Patrón de tipo de contenido, por ejemplo `image/(jpeg|png|webp|heic)`. */
  readonly contentType: string;
}

/** Escritura del cliente solo contra una reserva hecha antes por el servidor. */
export interface EscrituraSubidaReservada {
  readonly tipo: 'subidaReservada';
  readonly roles: readonly Rol[];
  /** Ruta de una colección del MISMO manifiesto, con escritura `servidor`. */
  readonly reserva: string;
  readonly archivos: readonly ArchivoSubida[];
}

/** Política de una ruta de Storage (aditivo y opcional, L1). */
export interface RutaAlmacenamiento {
  /** Relativa a `tenants/{tenantId}/`; empieza por `privado` o `publico`. */
  readonly ruta: string;
  readonly lectura: 'servidor' | 'publica';
  readonly escritura: 'servidor' | EscrituraSubidaReservada;
}

/** Zona del manifiesto (L2); sin ella se entiende `modulo`. */
export type ZonaManifiesto = 'nucleo' | 'central' | 'plataforma' | 'modulo';

/** Pantalla del panel que aporta un módulo (L2). */
export interface PantallaManifiesto {
  readonly id: string;
  readonly titulo: string;
  readonly roles: readonly Rol[];
  readonly orden: number;
  readonly tituloPorRol?: Partial<Record<Rol, string>>;
}

/** Acción (callable) que expone un módulo (L2). */
export interface AccionManifiesto {
  readonly callable: string;
  readonly nombre: string;
  readonly roles: readonly Rol[];
  readonly propietario?: boolean;
}

/** Tarea programada de un módulo (L2). */
export interface ProgramadaManifiesto {
  readonly id: string;
  readonly horario: string;
  readonly zonaHoraria: string;
  readonly porTenant: boolean;
}

export interface ManifiestoModulo {
  readonly id: IdModulo;
  /** Versión semver `MAYOR.MENOR.PARCHE`. */
  readonly version: string;
  readonly dependeDe: readonly IdModulo[];
  readonly submodulos: readonly string[];
  readonly colecciones: readonly ColeccionManifiesto[];
  readonly emite: readonly TipoEvento[];
  readonly consume: readonly TipoEvento[];
  /** Rutas de Storage del módulo; sin él, el módulo no declara archivos. */
  readonly almacenamiento?: readonly RutaAlmacenamiento[];
  /** L2: zona a la que pertenece; sin él, `modulo`. */
  readonly zona?: ZonaManifiesto;
  /** L2: pantallas del panel. No se admiten con `zona: 'nucleo'`. */
  readonly pantallas?: readonly PantallaManifiesto[];
  /** L2: acciones (callables). No se admiten con `zona: 'nucleo'`. */
  readonly acciones?: readonly AccionManifiesto[];
  /** L2: tareas programadas. */
  readonly programadas?: readonly ProgramadaManifiesto[];
  /**
   * L2 (D1): dependencias de ejecución por puertos. Cuentan para el encendido
   * y el alta; NO autorizan importaciones (eso es `dependeDe`).
   */
  readonly requiere?: readonly IdModulo[];
}
