import { contenido, enVenta } from '../contenido/instancia.js';
import { descripcionPlana, recortar } from '../lib/descripcion.js';
import { srcsetDe } from '../lib/medios.js';
import { rutaProducto } from '../lib/seo.js';

/**
 * Índice del buscador y de «Refinar la búsqueda»: solo los productos a la venta. Lleva lo necesario para pintar la tarjeta y
 * filtrar por precio (`p`, USD por mercado: el mismo dato que ya va en el HTML de cada tarjeta); sin existencias.
 */
export function GET(): Response {
  const nombreCat = new Map(contenido.categorias.map((c) => [c.id, c.nombre]));
  const indice = enVenta.map((p) => {
    const foto = p.fotos[0];
    return {
      i: p.id,
      nombre: p.nombre,
      marca: p.marca,
      categoria: nombreCat.get(p.categoria) ?? p.categoria,
      ruta: rutaProducto(p),
      c: p.categoria,
      p: p.precioUsd,
      r: recortar(descripcionPlana(p.descripcion), 140),
      ...(foto === undefined ? {} : { u: foto.url, s: srcsetDe(foto) }),
    };
  });
  return new Response(JSON.stringify(indice), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
