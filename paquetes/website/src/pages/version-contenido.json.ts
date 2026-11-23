import { contenidoPublicado } from '../contenido/instancia.js';
import { versionContenido } from '../lib/huella.js';

/** Declara de qué contenido (el publicado completo, con los agotados y las marcas como llegaron; no el de las listas del sitio) se compiló el sitio: solo conteos, versión, fecha y huella (sin datos del cliente). */
export function GET(): Response {
  return new Response(`${JSON.stringify(versionContenido(contenidoPublicado), null, 2)}\n`, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
