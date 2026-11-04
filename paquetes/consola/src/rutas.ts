import { esTenantIdValido } from '@plataforma/nucleo';
import { ErrorConsola } from './errores.js';

export const ID_PRODUCTO = /^[a-z0-9][a-z0-9-]{1,59}$/;
export const ID_SUBIDA = /^[A-Za-z0-9_-]{8,40}$/;
export const ID_SECCION = /^[a-z0-9][a-z0-9-]{0,29}$/;

export function tenantValido(tenantId: string): string {
  if (!esTenantIdValido(tenantId)) throw new ErrorConsola('entrada-invalida', 'tenantId inválido');
  return tenantId;
}

/** Rutas de Firestore (relativas a la raíz de la base de datos). */
export const rutaFicha = (t: string, productoId: string): string => `tenants/${t}/fichasWeb/${productoId}`;
export const rutaSeccion = (t: string, id: string): string => `tenants/${t}/secciones/${id}`;
export const rutaCarrusel = (t: string, plantilla: string): string => `tenants/${t}/carruseles/${plantilla}`;
export const rutaSitio = (t: string, doc: 'config' | 'indice' | 'slugs' | 'estado'): string => `tenants/${t}/sitio/${doc}`;
export const rutaPublicado = (t: string, doc: string): string => `tenants/${t}/publicado/${doc}`;
export const rutaSubida = (t: string, id: string): string => `tenants/${t}/subidas/${id}`;
export const rutaMedio = (t: string, id: string): string => `tenants/${t}/medios/${id}`;
export const rutaUsoMedios = (t: string): string => `tenants/${t}/uso/medios`;

/** Rutas de almacenamiento. El original es privado; solo las versiones procesadas son públicas. */
export const rutaOriginal = (t: string, productoId: string, subidaId: string): string =>
  `tenants/${t}/privado/originales/${productoId}/${subidaId}`;
export const dirTemporal = (t: string, subidaId: string): string => `tenants/${t}/privado/procesando/${subidaId}`;
export const rutaPublicaMedio = (t: string, productoId: string, nombre: string): string =>
  `tenants/${t}/publico/medios/${productoId}/${nombre}`;
