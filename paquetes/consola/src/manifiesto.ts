import type { ColeccionManifiesto, ManifiestoModulo, Rol } from '@novutienda/nucleo';

const CONSULTA: readonly Rol[] = ['sup', 'adm'];

/**
 * Todas las colecciones de la consola: el navegador solo lee (sup y adm; `caj` no usa la consola); escribe solo el servidor,
 * con las funciones de este módulo. Cada una es de un segmento (`tenants/{t}/<ruta>/{id}`):
 *  - `fichasWeb/{productoId}`, `secciones/{id}`, `carruseles/{plantilla}`: contenido editable.
 *  - `sitio/{config|indice|slugs|estado}`: configuración, orden de secciones, índice de slugs y cambios sin publicar.
 *  - `publicado/{...}`: copia que lee la reconstrucción del sitio (con el servidor); solo adm ve su estado.
 *  - `subidas/{id}`, `medios/{id}`: reservas y medios procesados.
 *  - `uso/medios`: cuota transaccional de originales y conteo de fotos/videos por producto.
 * `sup` puede leer todo y, por las funciones del servidor, editar fichas y subir medios; precios, importación,
 * secciones, apariencia y publicación son de `adm`.
 * No emite ni consume eventos v1: la disponibilidad pública se sirve por `/api/disponibilidad` y la reconstrucción se
 * agenda desde la publicación, no desde el stock.
 */
const colecciones: readonly ColeccionManifiesto[] = [
  { ruta: 'fichasWeb', lectura: CONSULTA, escritura: 'servidor' },
  { ruta: 'secciones', lectura: CONSULTA, escritura: 'servidor' },
  { ruta: 'carruseles', lectura: CONSULTA, escritura: 'servidor' },
  { ruta: 'sitio', lectura: CONSULTA, escritura: 'servidor' },
  { ruta: 'publicado', lectura: ['adm'], escritura: 'servidor' },
  { ruta: 'subidas', lectura: CONSULTA, escritura: 'servidor' },
  { ruta: 'medios', lectura: CONSULTA, escritura: 'servidor' },
  { ruta: 'uso', lectura: CONSULTA, escritura: 'servidor' },
];

/** Manifiesto del módulo consola (administración del catálogo y del sitio). Lo registra el coordinador. */
export const manifiestoConsola: ManifiestoModulo = {
  id: 'consola',
  version: '0.1.0',
  dependeDe: ['nucleo'],
  submodulos: [],
  colecciones,
  emite: [],
  consume: [],
};
