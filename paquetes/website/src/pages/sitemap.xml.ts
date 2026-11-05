import { contenido } from '../contenido/instancia.js';
import { rutaCategoria, rutaProducto, rutaSeccion, urlAbsoluta } from '../lib/seo.js';

const escapar = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function GET(): Response {
  const rutas = [
    '/', '/productos', '/contacto', '/privacidad',
    ...contenido.categorias.map((c) => rutaCategoria(c.id)),
    ...contenido.productos.map((p) => rutaProducto(p)),
    ...contenido.secciones.map((s) => rutaSeccion(s.slug)),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rutas.map((r) => `  <url><loc>${escapar(urlAbsoluta(contenido.config.origen, r))}</loc></url>`).join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
