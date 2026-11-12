/** SEO: URL canónicas y datos estructurados (JSON-LD) generados a partir de objetos del repositorio. */
import type { Contenido, Producto } from '../contenido/tipos.js';
import { descripcionPlana } from './descripcion.js';

export const rutaProducto = (p: Pick<Producto, 'slug'>): string => `/producto/${p.slug}`;
export const rutaCategoria = (id: string): string => `/productos/${id}`;
export const rutaSeccion = (slug: string): string => `/seccion/${slug}`;

export const urlAbsoluta = (origen: string, ruta: string): string => `${origen}${ruta.startsWith('/') ? ruta : `/${ruta}`}`;

/** Serializa JSON-LD de forma segura para incrustarlo en un `<script>`: nunca puede cerrar la etiqueta. */
export function jsonLdSeguro(objeto: unknown): string {
  return JSON.stringify(objeto).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

const PAIS_DE: Readonly<Record<'BO' | 'AR', string>> = { BO: 'BO', AR: 'AR' };

/** Product/Offer: el precio base es en USD por mercado; con precio 0 no hay oferta (se consulta). */
export function jsonLdProducto(p: Producto, c: Contenido): Record<string, unknown> {
  const o = c.config.origen;
  const ofertas = (['BO', 'AR'] as const)
    .filter((m) => c.config.mercados.includes(m) && p.precioUsd[m] > 0)
    .map((m) => ({
      '@type': 'Offer',
      price: p.precioUsd[m].toFixed(2),
      priceCurrency: 'USD',
      availability: p.disponible ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: urlAbsoluta(o, rutaProducto(p)),
      eligibleRegion: { '@type': 'Country', name: PAIS_DE[m] },
    }));
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.nombre,
    sku: p.id,
    description: descripcionPlana(p.descripcion),
    brand: { '@type': 'Brand', name: p.marca },
    ...(p.fotos.length > 0 ? { image: p.fotos.map((f) => (f.url.startsWith('/') ? urlAbsoluta(o, f.url) : f.url)) } : {}),
    ...(p.garantia !== null ? { warranty: { '@type': 'WarrantyPromise', description: p.garantia } } : {}),
    ...(ofertas.length > 0 ? { offers: ofertas } : {}),
  };
}

export function jsonLdOrganizacion(c: Contenido): Record<string, unknown> {
  const cfg = c.config;
  return {
    '@context': 'https://schema.org',
    '@type': 'Store',
    name: cfg.nombre,
    url: cfg.origen,
    ...(cfg.telefono !== null ? { telephone: cfg.telefono } : {}),
    ...(cfg.correo !== null ? { email: cfg.correo } : {}),
    address: { '@type': 'PostalAddress', streetAddress: cfg.direccion },
  };
}

export const tituloPagina = (titulo: string, nombreSitio: string): string => `${titulo} | ${nombreSitio}`;
