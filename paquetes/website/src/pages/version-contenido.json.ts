import { contenido } from '../contenido/instancia.js';
import { versionContenido } from '../lib/huella.js';

/** Declara de qué contenido se compiló el sitio: solo conteos, versión, fecha y huella (sin datos del cliente). */
export function GET(): Response {
  return new Response(`${JSON.stringify(versionContenido(contenido), null, 2)}\n`, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
