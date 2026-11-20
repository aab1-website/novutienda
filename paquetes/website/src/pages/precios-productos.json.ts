import { contenido } from '../contenido/instancia.js';

/**
 * Precios base (USD por mercado) de los productos publicados, para el total referencial del pedido.
 * Son los mismos valores que ya van en el HTML (props de `Precio` y `Filtros`); la conversión la hace el navegador
 * con la cotización oficial y `precioFinal`.
 */
export function GET(): Response {
  const precios: Record<string, unknown> = {};
  for (const p of contenido.productos) precios[p.id] = p.precioUsd;
  return new Response(JSON.stringify(precios), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
