import { createHash } from 'node:crypto';

/** JSON canónico: claves ordenadas; `undefined` se omite. Mismo contenido, mismo texto. */
export function canonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;
  if (typeof valor === 'object' && valor !== null) {
    const o = valor as Record<string, unknown>;
    const partes = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`);
    return `{${partes.join(',')}}`;
  }
  return JSON.stringify(valor) ?? 'null';
}

export const hashCarga = (tipo: string, carga: unknown): string =>
  createHash('sha256').update(`${tipo}\n${canonico(carga)}`).digest('hex');
