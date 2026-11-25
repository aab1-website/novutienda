export const OPERADOR_SCRIPT: string;
export const USO: string;
export const PRECIO_EJEMPLO: number;
export class ErrorUso extends Error {}
export interface ReglaScript { readonly tipo: 'decimales' | 'multiplo'; readonly decimales?: number; readonly multiplo?: number; readonly modo: string }
export interface OpcionesFijar { tenant: string; proyecto?: string; reglas: Record<string, ReglaScript>; modo: string; motivo?: string; uid: string; aplicar: boolean; seco: boolean; confirmarProduccion: boolean }
export interface DependenciasFijar {
  comercialDe(tenant: string): Promise<{ readonly mercados: readonly { readonly monedaVenta: string }[] }>;
  documentoRedondeo(tenant: string): Promise<Record<string, unknown> | undefined>;
  transaccion<R>(fn: (tx: unknown) => Promise<R>): Promise<R>;
  fijarRedondeoDe(tx: unknown, entrada: Record<string, unknown>): Promise<{ tipo: string; cambiadas?: readonly string[]; motivo?: string }>;
  interpretarRedondeoDe(datos: Record<string, unknown> | undefined, comercial: unknown): Record<string, ReglaScript>;
  redondear(monto: number, regla: ReglaScript): number;
  motivoReglaRedondeoInvalida(regla: unknown): string | null;
}
export function parsearRegla(texto: string | undefined, modo?: string): ReglaScript;
export function leerArgumentos(args: readonly string[]): OpcionesFijar;
export function validarEntrada(args: readonly string[], env: Record<string, string | undefined>): { o: OpcionesFijar; entorno: { proyecto: string; ambiente: string; enEmulador: boolean }; error?: undefined } | { error: string; o?: undefined; entorno?: undefined };
export function ejecutar(args: readonly string[], env: Record<string, string | undefined>, deps: DependenciasFijar): Promise<{ codigo: number; salida: string[]; error?: string }>;
export function dependenciasReales(proyecto: string): Promise<DependenciasFijar>;
