export const LIMITE_MIN: number;
export interface TrabajoSitio { readonly id: string; readonly estado?: unknown; readonly version?: unknown; readonly motivo?: unknown; readonly solicitadaEnMs?: unknown; readonly completadaEnMs?: unknown }
export interface FilaLatencia { readonly id: string; readonly estado: string; readonly base: 'publicacion' | 'solicitud'; readonly ms: number | null; readonly atrasado: boolean }
export interface ResultadoLatencia { readonly filas: FilaLatencia[]; readonly medidos: number; readonly p50Ms: number | null; readonly maxMs: number | null; readonly fallidas: number; readonly atrasadas: number; readonly limiteMin: number }
export function mediana(valores: readonly number[]): number | null;
export function calcularLatencias(trabajos: readonly TrabajoSitio[], estadoPublicado: { version?: unknown; publicadoEn?: unknown } | undefined, opciones: { desdeMs: number; ahoraMs: number; limiteMin?: number }): ResultadoLatencia;
export function formatear(r: ResultadoLatencia): string;
export function leerArgumentos(args: readonly string[]): { tenant: string; desde: string; desdeMs: number; proyecto?: string; limiteMin: number; json: boolean };
