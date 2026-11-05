import { contenido } from '../contenido/instancia.js';
import { rutaProducto } from '../lib/seo.js';

/** Índice del buscador: solo nombre, marca, categoría y ruta (sin precios ni existencias). */
export function GET(): Response {
  const nombreCat = new Map(contenido.categorias.map((c) => [c.id, c.nombre]));
  const indice = contenido.productos.map((p) => ({
    i: p.id,
    nombre: p.nombre,
    marca: p.marca,
    categoria: nombreCat.get(p.categoria) ?? p.categoria,
    ruta: rutaProducto(p),
  }));
  return new Response(JSON.stringify(indice), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
