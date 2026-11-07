export interface ColeccionReglas {
  readonly ruta: string;
  readonly limite?: string;
  /** 'raiz': colección fuera de tenants/{tenantId}, solo servidor. Por defecto 'tenant'. */
  readonly ambito?: 'tenant' | 'raiz';
  readonly lectura: readonly string[];
  readonly escritura: 'servidor' | readonly string[];
}
export interface ArchivoSubidaReglas {
  readonly tipo: string;
  readonly bytesMax: number;
  readonly contentType: string;
}
export interface RutaAlmacenamientoReglas {
  readonly ruta: string;
  readonly lectura: 'servidor' | 'publica';
  readonly escritura:
    | 'servidor'
    | {
        readonly tipo: 'subidaReservada';
        readonly roles: readonly string[];
        readonly reserva: string;
        readonly archivos: readonly ArchivoSubidaReglas[];
      };
}
export interface ManifiestoReglas {
  readonly id: string;
  readonly colecciones: readonly ColeccionReglas[];
  readonly almacenamiento?: readonly RutaAlmacenamientoReglas[];
}
export const PROVEEDOR_PERSONAS: string;
/** Campos del documento de reserva que lee la plantilla `reservaValida`. */
export const CAMPOS_PLANTILLA_RESERVA: readonly string[];
export class ErrorGenerador extends Error {}
export function generarReglas(manifiestos: readonly ManifiestoReglas[]): string;
export function generarReglasAlmacenamiento(manifiestos: readonly ManifiestoReglas[]): string;
export function cargarManifiestos(raiz?: string): Promise<ManifiestoReglas[]>;
