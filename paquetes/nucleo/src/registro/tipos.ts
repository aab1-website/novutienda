// Tipos congelados del registro de módulos (ola 1a). Sin importaciones.

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
}
