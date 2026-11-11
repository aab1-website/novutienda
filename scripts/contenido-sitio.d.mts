export type CalcularFirma = (secreto: string, marcaTiempo: string, cuerpo: string) => string;
export type Mapear = (respuesta: unknown, negocio: unknown, entorno: unknown) => unknown;
export interface Dependencias { readonly calcularFirma?: CalcularFirma; readonly mapear: Mapear }
export interface OpcionesPeticion {
  readonly tenant: string;
  readonly url: string;
  readonly secreto: string;
  readonly calcularFirma?: CalcularFirma;
  readonly ahoraMs?: number;
  readonly fetchFn?: typeof fetch;
}
export const RE_TENANT: RegExp;
export const RE_ID_TRABAJO: RegExp;
export const ESTADOS: readonly string[];
export const LOTE_DISPONIBILIDAD: number;
export const CODIGO_TOMADO_POR_OTRO: number;
export const CODIGO_INEXISTENTE: number;
export const TIEMPO_MAXIMO_MS: number;
export function calcularFirmaLocal(secreto: string, marcaTiempo: string, cuerpo: string): string;
export function idsValidos(ids: readonly string[]): string[];
export class ErrorContenidoSitio extends Error { readonly codigo: number }
export function normalizarUrl(url: unknown, permitirLocal?: boolean, nombre?: string): string;
export function validarTenant(tenant: unknown): string;
export function cabecerasFirmadas(p: { secreto: string; metodo: string; ruta: string; cuerpo?: string; ahoraMs: number; calcularFirma?: CalcularFirma }): Record<string, string>;
export function rutaPendientes(tenant: string): string;
export function rutaEstado(id: string): string;
export function rutaPublicado(tenant: string): string;
export function rutaDisponibilidad(ids: readonly string[]): string;
export function pedirFirmado(p: OpcionesPeticion & { metodo: string; ruta: string; cuerpo?: unknown }): Promise<{ estado: number; json: Record<string, unknown> | null }>;
export function trabajoPendiente(opciones: OpcionesPeticion): Promise<string | null>;
export function cambiarEstado(opciones: OpcionesPeticion, id: string, estado: string): Promise<'cambiado' | 'repetido'>;
export function idsDeProductos(publicado: unknown): string[];
export function lotes<T>(ids: readonly T[], tamano?: number): T[][];
export function leerDisponibilidad(p: { url: string; ids: readonly string[]; fetchFn?: typeof fetch }): Promise<Record<string, boolean>>;
export function appCheckDesdeEntorno(env: Record<string, string | undefined>): { claveSitio: string; apiKey: string; appId: string; projectId: string } | null;
export function negocioDesdeEntorno(env: Record<string, string | undefined>): unknown;
export function generarContenido(p: { tenant: string; url: string; secreto: string; env: Record<string, string | undefined>; calcularFirma?: CalcularFirma; mapear: Mapear; ahoraMs?: number; fetchFn?: typeof fetch }): Promise<{ contenido: unknown; productos: number; invalidos: number }>;
export function ejecutar(args: readonly string[], env?: Record<string, string | undefined>, deps?: Dependencias, fetchFn?: typeof fetch): Promise<{ codigo: number; salida?: string; error?: string }>;
