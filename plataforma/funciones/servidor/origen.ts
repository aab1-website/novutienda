// Origen de la petición para el límite de tasa. NUNCA se confía en `Fastly-Client-IP` ni en el primer elemento de
// `X-Forwarded-For`: el cliente puede escribir ambos (la función es invocable directamente por su URL, sin pasar
// por Hosting) y así elegiría su propia clave de límite. Cada proxy de confianza AÑADE al final de `X-Forwarded-For`
// la dirección de quien le conectó; lo que está antes del último salto confiable lo controla el cliente.
// Cadena esperada detrás de Hosting: `<lo que escribió el cliente>, <IP del cliente vista por Fastly>, <IP de Fastly vista por el GFE>`;
// por eso el cliente es el elemento a `saltos` (2) posiciones del final. Con acceso directo a la URL de la función la cadena es
// `<escrito por el cliente>, <IP real vista por el GFE>`: queda la IP real si hay un solo elemento y, si el cliente antepuso
// valores, el penúltimo (que podría falsear): por eso el límite por origen NUNCA es la única defensa (App Check y
// el límite por instancia van aparte). Los saltos son el parámetro `PROXY_SALTOS`: se verifica en staging (docs/produccion/pase-a-staging.md).
import { isIP } from 'node:net';

export const ORIGEN_DESCONOCIDO = 'desconocido';

/** IP del último salto confiable de `X-Forwarded-For`, o `desconocido` si la cadena falta o no es una IP. */
export function ipDelCliente(forwardedFor: string | undefined, saltos: number): string {
  if (forwardedFor === undefined || !Number.isInteger(saltos) || saltos < 1) return ORIGEN_DESCONOCIDO;
  const cadena = forwardedFor.split(',').map((p) => p.trim()).filter((p) => p !== '');
  const elegido = cadena[Math.max(0, cadena.length - saltos)];
  return elegido !== undefined && isIP(elegido) !== 0 ? elegido : ORIGEN_DESCONOCIDO;
}
