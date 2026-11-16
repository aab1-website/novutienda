// Códigos de salida de ejecutar: 0 coincide (puede haber avisos); 1 diferencias firmes; 2 uso inválido; 3 error de operación (no se pudo comparar).
import type { CalcularFirma, Esperar, Mapear } from './contenido-sitio.mjs';

export interface Diferencia { campo: string; n: number; posiciones?: number[] }
export interface Comprobacion {
  nombre: string;
  estado: 'ok' | 'aviso' | 'error';
  conteos: Record<string, number>;
  diferencias: Diferencia[];
  avisos: { campo: string; texto?: string; n?: number; posiciones?: number[] }[];
  motivo: string | undefined;
  /** true = no se pudo leer lo que se debía comparar (no es una diferencia del sitio). */
  operacion?: boolean;
}
export interface Isla { componente: string; props: Record<string, unknown> }
export interface ProductoCert { id: string; slug: string; nombre: string; precioUsd: Record<string, number>; disponible: boolean }
export interface ConfigCert { plantilla: string; whatsappNovuchat: string | null; mercados: readonly string[]; redondeo: unknown }
export interface ContenidoCert { config: ConfigCert; productos: readonly ProductoCert[]; secciones: readonly { slug: string }[] }
export interface DependenciasCert { calcularFirma?: CalcularFirma; mapear: Mapear; versionContenido: (contenido: unknown) => unknown }

export const CONCURRENCIA: number;
export const MAX_POSICIONES: number;
export function decodificarEntidades(texto: string): string;
export function etiquetas(html: string, nombre: string): { atributos: string; inicio: number; fin: number }[];
export function atributos(texto: string): Record<string, string>;
export function textoPlano(fragmento: string): string;
export function interiorDe(html: string, etiqueta: { fin: number }, cierre: string): string | null;
export function primerH1(html: string): string | null;
export function plantillaDe(html: string): string | null;
export function configCliente(html: string): Record<string, unknown> | null;
export function jsonLdDe(html: string): Record<string, unknown>[];
export function islasDe(html: string): Isla[];
export function metaFicha(html: string): string | null;
export function canon(v: unknown): string;
export function compararVersion(esperada: Record<string, unknown>, desplegada: unknown): { errores: string[]; avisos: string[]; motivo?: string };
export function compararIndice(productos: readonly ProductoCert[], indice: unknown): { campos: Record<string, number> };
export function compararFicha(p: ProductoCert, config: ConfigCert, html: string): { campos: string[]; disponibleHtml: boolean | undefined };
export function compararPortada(config: ConfigCert, html: string): string[];
export function compararCotizacion(mercados: readonly string[], cuerpo: unknown): { diferencias: string[]; avisos: string[] };
export function comprobacion(nombre: string): Comprobacion;
export function cerrar(c: Comprobacion): Comprobacion;
export function agruparCampos(lista: readonly { posicion?: number; campos: readonly string[] }[]): { campo: string; n: number; posiciones: number[] }[];
export function codigoDe(comprobaciones: readonly Comprobacion[]): 0 | 1 | 3;
export const REF_BUILD: string;
export const REF_REGENERADO: string;
export function leerContenidoDelBuild(ruta: string): ContenidoCert;
export function armarSalida(comprobaciones: readonly Comprobacion[], referencia?: string): string;
export function armarResumen(comprobaciones: readonly Comprobacion[], referencia?: string): string;
export function conConcurrencia<T, R>(lista: readonly T[], n: number, tarea: (x: T, i: number) => Promise<R>): Promise<R[]>;
export function certificar(p: { url: string; contenido: ContenidoCert; versionContenido: (contenido: unknown) => unknown; fetchFn?: typeof fetch; esperar?: Esperar; avisar?: (mensaje: string) => void }): Promise<Comprobacion[]>;
export function ejecutar(args: readonly string[], env?: Record<string, string | undefined>, deps?: DependenciasCert, fetchFn?: typeof fetch, red?: { esperar?: Esperar; avisar?: (mensaje: string) => void }): Promise<{ codigo: 0 | 1 | 2 | 3; salida?: string; error?: string }>;
