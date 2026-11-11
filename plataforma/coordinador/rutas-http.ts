// Encendido en HTTP (L3-3): qué módulo es dueño de una ruta de la API y si el tenant lo tiene encendido. El dueño sale de
// `rutasHttp` de los manifiestos (vía el registro); aquí no se enumera ninguna ruta ni módulo. Falla cerrado: una ruta sin
// dueño, un tenant sin documento o con documento inválido, o un módulo fuera de los efectivos, no se sirve.
import { registroPlataforma } from '../registro.js';
import type { LectorModulos } from './modulos-activos.js';

/** Lo mínimo del registro que se necesita (acepta el real o un doble de prueba). */
export type FuenteDeRutas = Pick<typeof registroPlataforma, 'rutasHttp'>;

/** Módulo dueño de la ruta: coincidencia exacta primero; si no, el prefijo declarado (`/api/sitio/v1` cubre `/api/sitio/v1/x`). */
export function duenoDeRuta(ruta: string, fuente: FuenteDeRutas = registroPlataforma): string | undefined {
  const rutas = fuente.rutasHttp();
  const exacta = rutas.find((r) => r.ruta === ruta);
  if (exacta !== undefined) return exacta.modulo;
  return rutas.find((r) => r.prefijo === true && ruta.startsWith(`${r.ruta}/`))?.modulo;
}

/**
 * `true` si el dueño está entre los módulos efectivos del tenant. `undefined` (sin documento o inválido) → `false`.
 * Si el lector lanza (Firestore caído), el error se propaga: la petición no se sirve (500), nunca se sirve por defecto.
 */
export async function rutaEncendida(modulosDelTenant: LectorModulos, tenantId: string, dueno: string | undefined): Promise<boolean> {
  if (dueno === undefined) return false;
  const modulos = await modulosDelTenant(tenantId);
  return modulos !== undefined && (modulos as readonly string[]).includes(dueno);
}
