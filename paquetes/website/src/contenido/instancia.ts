import { cargarContenido } from './cargar.js';
import { categoriasConVenta, enVenta as soloEnVenta, productosEnOrdenDeCategorias, unificarMarcas } from './consultas.js';

const cargado = cargarContenido();

/**
 * El contenido tal como se publicó, sin tocar: es el que declara `/version-contenido.json` y el que compara la certificación del
 * sitio (la huella no puede depender de cómo el sitio ordena o presenta los datos, ni de qué productos estén agotados).
 */
export const contenidoPublicado = cargado;

/** Contenido del sitio para este build (validado una sola vez). Las marcas que difieren solo en mayúsculas quedan unificadas. */
export const contenido = { ...cargado, productos: unificarMarcas(cargado.productos) };

/**
 * Productos a la venta (con stock en Tienda al construir): son los que listan el catálogo, las categorías, las marcas, la
 * portada y el buscador. Las fichas se generan para todos (`contenido.productos`) y marcan «sin stock» a los agotados.
 */
export const enVenta = soloEnVenta(contenido.productos);

/** Productos a la venta agrupados por categoría en el orden del menú (listado /productos y su índice). */
export const catalogo = productosEnOrdenDeCategorias(enVenta, contenido.categorias);

/** Categorías con algo a la venta, en el orden del menú: las únicas que se listan (menú, portada, sitemap). */
export const categoriasNavegables = categoriasConVenta(contenido.categorias, contenido.productos);
