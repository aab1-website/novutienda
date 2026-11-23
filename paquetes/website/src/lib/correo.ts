import { esCorreoSimple } from '../contenido/validar.js';

/**
 * Enlace `mailto:` de un correo del negocio, o `null` si no cumple `esCorreoSimple`. El correo se valida solo por largo al cargar el
 * negocio (como la consola en el nivel heredado), así que aquí se decide si es seguro armar el enlace: un valor como `a@b.co?bcc=x`
 * o con espacios se muestra como texto, sin enlace.
 */
export const hrefCorreo = (correo: string): string | null => (esCorreoSimple(correo) ? `mailto:${correo}` : null);
