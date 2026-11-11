export interface SitioTenant { readonly clave: string; readonly tenant: string; readonly sitio: string; readonly url: string }
export const RE_CLAVE: RegExp;
export const RE_TENANT: RegExp;
export const RE_SITIO: RegExp;
export const AMBIENTES: readonly string[];
export class ErrorSitios extends Error { readonly errores: readonly string[] }
export function parsearSitios(texto: string | undefined): SitioTenant[];
export function construirMatriz(sitios: readonly SitioTenant[], clave?: string): { include: SitioTenant[] };
export function entradasDeSolo(lista: string | undefined): string[];
export function validarSolo(ambiente: string, lista: string | undefined, sitios?: readonly SitioTenant[]): string[];
export function ejecutar(args: readonly string[], env?: Record<string, string | undefined>): { codigo: number; salida?: string; error?: string };
export const RE_SOLO_STAGING: RegExp;
