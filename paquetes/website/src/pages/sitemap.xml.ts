import { contenido } from '../contenido/instancia.js';
import { marcasDe, productosDeCategoria } from '../contenido/consultas.js';
import { marcasConRuta, paginasExtra, rutaMarca, rutaPagina } from '../lib/paginas.js';
import { rutaCategoria, rutaProducto, rutaSeccion, urlAbsoluta } from '../lib/seo.js';

const escapar = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const paginas = (base: string, cantidad: number): string[] => [base, ...paginasExtra(cantidad).map((n) => rutaPagina(base, n))];

export function GET(): Response {
  const rutas = [
    '/', '/contacto', '/privacidad',
    ...paginas('/productos', contenido.productos.length),
    ...contenido.categorias.flatMap((c) => paginas(rutaCategoria(c.id), productosDeCategoria(contenido.productos, c.id).length)),
    ...marcasConRuta(marcasDe(contenido.productos)).flatMap((m) => paginas(rutaMarca(m.slug), contenido.productos.filter((p) => p.marca === m.nombre).length)),
    ...contenido.productos.map((p) => rutaProducto(p)),
    ...contenido.secciones.map((s) => rutaSeccion(s.slug)),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rutas.map((r) => `  <url><loc>${escapar(urlAbsoluta(contenido.config.origen, r))}</loc></url>`).join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
