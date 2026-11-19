/**
 * Contrato de la causa saneada de una publicación fallida del sitio.
 * Solo viajan códigos, el id del producto y el mercado: nunca texto libre.
 * La validación es estricta y sin expresiones regulares (sin riesgo de ReDoS).
 */

export const CODIGOS_CAUSA_SITIO = [
  'precio_fuera_de_tope',
  'categoria_invalida',
  'demasiadas_categorias',
  'contenido_invalido',
] as const;
export type CodigoCausaSitio = (typeof CODIGOS_CAUSA_SITIO)[number];

export const ETAPAS_FALLA_SITIO = [
  'generar',
  'build',
  'pruebas',
  'despliegue',
  'humo',
  'certificacion',
  'cancelado',
] as const;
export type EtapaFallaSitio = (typeof ETAPAS_FALLA_SITIO)[number];

export const MAX_CAUSAS_SITIO = 20;
export const LARGO_MAXIMO_ID_PRODUCTO = 80;

export interface CausaFallaSitio {
  codigo: CodigoCausaSitio;
  productoId?: string;
  mercado?: string;
}

function esMinusculaODigito(c: number): boolean {
  return (c >= 97 && c <= 122) || (c >= 48 && c <= 57);
}

/** Id de producto: `[a-z0-9][a-z0-9-]{0,79}`. */
export function esIdProductoSitio(x: unknown): x is string {
  if (typeof x !== 'string' || x.length === 0 || x.length > LARGO_MAXIMO_ID_PRODUCTO) {
    return false;
  }
  if (!esMinusculaODigito(x.charCodeAt(0))) return false;
  for (let i = 1; i < x.length; i += 1) {
    const c = x.charCodeAt(i);
    if (!esMinusculaODigito(c) && c !== 45) return false;
  }
  return true;
}

/** Mercado: dos letras mayúsculas ASCII. */
export function esMercadoSitio(x: unknown): x is string {
  if (typeof x !== 'string' || x.length !== 2) return false;
  const a = x.charCodeAt(0);
  const b = x.charCodeAt(1);
  return a >= 65 && a <= 90 && b >= 65 && b <= 90;
}

export function esEtapaFallaSitio(x: unknown): x is EtapaFallaSitio {
  return typeof x === 'string' && (ETAPAS_FALLA_SITIO as readonly string[]).includes(x);
}

const CLAVES_PERMITIDAS: readonly string[] = ['codigo', 'productoId', 'mercado'];

function leerCausa(x: unknown): CausaFallaSitio | null {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!CLAVES_PERMITIDAS.includes(k)) return null;
  }
  const { codigo, productoId, mercado } = o;
  if (typeof codigo !== 'string' || !(CODIGOS_CAUSA_SITIO as readonly string[]).includes(codigo)) {
    return null;
  }
  const causa: CausaFallaSitio = { codigo: codigo as CodigoCausaSitio };
  if (productoId !== undefined) {
    if (!esIdProductoSitio(productoId)) return null;
    causa.productoId = productoId;
  }
  if (mercado !== undefined) {
    if (!esMercadoSitio(mercado)) return null;
    causa.mercado = mercado;
  }
  return causa;
}

/**
 * Valida estrictamente una lista de causas: descarta las inválidas (código
 * desconocido, campos de más, id o mercado mal formados) y conserva como
 * máximo las primeras `MAX_CAUSAS_SITIO` válidas. Si no es una lista, `[]`.
 */
export function leerCausasFallaSitio(x: unknown): CausaFallaSitio[] {
  if (!Array.isArray(x)) return [];
  const salida: CausaFallaSitio[] = [];
  for (const item of x) {
    if (salida.length >= MAX_CAUSAS_SITIO) break;
    const causa = leerCausa(item);
    if (causa) salida.push(causa);
  }
  return salida;
}
