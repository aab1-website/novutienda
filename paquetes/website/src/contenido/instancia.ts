import { cargarContenido } from './cargar.js';
import { enVenta as soloEnVenta, unificarMarcas } from './consultas.js';

const cargado = cargarContenido();

/** Contenido del sitio para este build (validado una sola vez). Las marcas que difieren solo en mayúsculas quedan unificadas. */
export const contenido = { ...cargado, productos: unificarMarcas(cargado.productos) };

/**
 * Productos a la venta (con stock en Tienda al construir): son los que listan el catálogo, las categorías, las marcas, la
 * portada y el buscador. Las fichas se generan para todos (`contenido.productos`) y marcan «sin stock» a los agotados.
 */
export const enVenta = soloEnVenta(contenido.productos);
