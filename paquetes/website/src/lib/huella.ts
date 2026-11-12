/**
 * Huellas del contenido con el que se compiló el sitio (`/version-contenido.json`, esquema 2).
 *
 * Algoritmo (para que un verificador externo lo reproduzca a partir del contenido):
 *   1. JSON canónico del objeto `Contenido` (el que entrega `cargarContenido`): objetos con las claves en orden ascendente
 *      por unidades de código UTF-16 (aplicado recursivamente), sin espacios; arreglos en su orden; las propiedades con valor
 *      `undefined` se omiten (y en un arreglo valen `null`); cadenas y números con la serialización de `JSON.stringify`.
 *   2. SHA-256 de esa cadena codificada en UTF-8, en hexadecimal minúscula.
 *
 * Dos huellas:
 *   - `huella`: sobre el `Contenido` completo. Incluye `productos[].disponible`, que es una foto del stock en el momento del
 *     build, así que la misma publicación da otra huella si el stock cambió. No es reproducible por un tercero.
 *   - `huellaSinDisponibilidad`: la misma huella canónica sobre el contenido sin la propiedad `disponible` de cada producto
 *     (nada más se excluye). Es la que se verifica.
 *
 * Insumos de la reproducción: el `Contenido` depende de la publicación (documentos firmados de la API), de los datos del
 * negocio y del entorno de build (orígenes, claves públicas, appCheck) y de la versión del código que lo mapea. Un
 * verificador que regenere el contenido con el MISMO entorno de build y la MISMA versión del código debe obtener la misma
 * `huellaSinDisponibilidad`.
 */
import { createHash } from 'node:crypto';

export function jsonCanonico(valor: unknown): string {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor) ?? 'null';
  if (Array.isArray(valor)) return `[${valor.map((x) => jsonCanonico(x === undefined ? null : x)).join(',')}]`;
  const o = valor as Record<string, unknown>;
  const claves = Object.keys(o).filter((k) => o[k] !== undefined && typeof o[k] !== 'function').sort();
  return `{${claves.map((k) => `${JSON.stringify(k)}:${jsonCanonico(o[k])}`).join(',')}}`;
}

export const huellaContenido = (contenido: unknown): string => createHash('sha256').update(jsonCanonico(contenido), 'utf8').digest('hex');

/** Contenido sin `disponible` en cada producto: la única parte volátil entre builds de una misma publicación. */
export function sinDisponibilidad(contenido: unknown): unknown {
  if (contenido === null || typeof contenido !== 'object' || Array.isArray(contenido)) return contenido;
  const c = contenido as Record<string, unknown>;
  if (!Array.isArray(c['productos'])) return contenido;
  const productos = c['productos'].map((p) => {
    if (p === null || typeof p !== 'object' || Array.isArray(p)) return p;
    const resto: Record<string, unknown> = { ...(p as Record<string, unknown>) };
    delete resto['disponible'];
    return resto;
  });
  return { ...c, productos };
}

export const huellaSinDisponibilidad = (contenido: unknown): string => huellaContenido(sinDisponibilidad(contenido));

export interface VersionContenido {
  readonly esquema: 2;
  readonly version: number | null;
  readonly publicadoEn: string | null;
  readonly productos: number;
  readonly secciones: number;
  readonly huella: string;
  readonly huellaSinDisponibilidad: string;
}

export function versionContenido(c: { productos: readonly unknown[]; secciones: readonly unknown[]; publicacion?: { version: number | null; publicadoEn: string | null } }): VersionContenido {
  return {
    esquema: 2,
    version: c.publicacion?.version ?? null,
    publicadoEn: c.publicacion?.publicadoEn ?? null,
    productos: c.productos.length,
    secciones: c.secciones.length,
    huella: huellaContenido(c),
    huellaSinDisponibilidad: huellaSinDisponibilidad(c),
  };
}
