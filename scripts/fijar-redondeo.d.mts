export const USO: string;
export const PRECIO_EJEMPLO: number;
export class ErrorUso extends Error {}
export interface ReglaScript { readonly tipo: 'decimales' | 'multiplo'; readonly decimales?: number; readonly multiplo?: number; readonly modo: string }
export interface OpcionesFijar { tenant: string; proyecto?: string; reglas: Record<string, ReglaScript>; modo: string; motivo?: string; aplicar: boolean; seco: boolean; confirmarProduccion: boolean }
export interface DependenciasFijar {
  comercialDe(tenant: string): Promise<{ readonly mercados: readonly { readonly monedaVenta: string }[] }>;
  vigentesDe(tenant: string, comercial: unknown): Promise<{ reglas: Record<string, ReglaScript>; invalido: boolean }>;
  cuenta(): Promise<string | undefined> | string | undefined;
  uidDeScript(cuenta: string | undefined): string;
  transaccion<R>(fn: (tx: unknown) => Promise<R>): Promise<R>;
  fijarRedondeoDe(tx: unknown, entrada: Record<string, unknown>): Promise<{ tipo: string; cambiadas?: readonly string[]; motivo?: string }>;
  redondear(monto: number, regla: ReglaScript): number;
  motivoReglaRedondeoInvalida(regla: unknown): string | null;
}
export function parsearRegla(texto: string | undefined, modo?: string): ReglaScript;
export function leerArgumentos(args: readonly string[]): OpcionesFijar;
export function validarEntrada(args: readonly string[], env: Record<string, string | undefined>): { o: OpcionesFijar; entorno: { proyecto: string; ambiente: string; enEmulador: boolean }; error?: undefined } | { error: string; o?: undefined; entorno?: undefined };
export function ejecutar(args: readonly string[], env: Record<string, string | undefined>, deps: DependenciasFijar): Promise<{ codigo: number; salida: string[]; error?: string }>;
export function cuentaDelOperador(env: Record<string, string | undefined>): string | undefined;
export function dependenciasReales(proyecto: string, env?: Record<string, string | undefined>): Promise<DependenciasFijar>;
