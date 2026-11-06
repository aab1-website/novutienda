export interface ColeccionReglas {
  readonly ruta: string;
  readonly limite?: string;
  /** 'raiz': colección fuera de tenants/{tenantId}, solo servidor. Por defecto 'tenant'. */
  readonly ambito?: 'tenant' | 'raiz';
  readonly lectura: readonly string[];
  readonly escritura: 'servidor' | readonly string[];
}
export interface ManifiestoReglas {
  readonly id: string;
  readonly colecciones: readonly ColeccionReglas[];
}
export const PROVEEDOR_PERSONAS: string;
export class ErrorGenerador extends Error {}
export function generarReglas(manifiestos: readonly ManifiestoReglas[]): string;
export function cargarManifiestos(raiz?: string): Promise<ManifiestoReglas[]>;
