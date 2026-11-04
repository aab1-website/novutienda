/** Utilidades de validación en el borde. Acumulan errores en vez de lanzar en el primero. */

export type Validacion<T> = { readonly ok: true; readonly valor: T } | { readonly ok: false; readonly errores: readonly string[] };

export const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

const ETIQUETA_HTML = /<\/?[a-zA-Z!][^>]*>/;

/** Verdadero si el texto trae caracteres de control (se admiten salto de línea y tabulación si `multilinea`). */
function tieneControl(t: string, multilinea: boolean): boolean {
  for (const c of t) {
    const p = c.codePointAt(0) ?? 0;
    if (multilinea && (p === 10 || p === 9)) continue;
    if (p < 32 || p === 127) return true;
  }
  return false;
}

export interface OpcionesTexto {
  readonly min?: number;
  readonly max: number;
  readonly multilinea?: boolean;
}

/** Texto plano: sin etiquetas HTML ni caracteres de control. Devuelve undefined si es inválido (y anota el error). */
export function textoPlano(v: unknown, campo: string, op: OpcionesTexto, errores: string[]): string | undefined {
  if (typeof v !== 'string') {
    errores.push(`${campo}: debe ser texto`);
    return undefined;
  }
  const min = op.min ?? 0;
  if (v.length < min) errores.push(`${campo}: es obligatorio`);
  else if (v.length > op.max) errores.push(`${campo}: máximo ${String(op.max)} caracteres`);
  else if (tieneControl(v, op.multilinea === true)) errores.push(`${campo}: contiene caracteres de control`);
  else if (ETIQUETA_HTML.test(v)) errores.push(`${campo}: no se admite HTML`);
  else return v;
  return undefined;
}

/** Anota un error por cada clave que no esté permitida (rechaza campos desconocidos). */
export function soloClaves(o: Record<string, unknown>, permitidas: readonly string[], ruta: string, errores: string[]): void {
  for (const k of Object.keys(o)) if (!permitidas.includes(k)) errores.push(`${ruta}: campo desconocido «${k}»`);
}

export const resultado = <T>(errores: string[], valor: T): Validacion<T> =>
  errores.length === 0 ? { ok: true, valor } : { ok: false, errores };
