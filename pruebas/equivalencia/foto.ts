// Fotos de referencia de la batería de equivalencia: guardan, como texto estable, lo que hoy produce el sistema para
// el tenant de referencia. La comparación es byte a byte; al fallar muestra un diff legible por línea. Las referencias solo se
// regeneran de forma explícita (EQUIVALENCIA_ACTUALIZAR=1, vía `pnpm equivalencia:actualizar`) y nunca en CI.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CARPETA_REFERENCIAS = fileURLToPath(new URL('./referencias/', import.meta.url));

export const actualizando = (): boolean => process.env['EQUIVALENCIA_ACTUALIZAR'] === '1';

/** Serializa con claves ordenadas (a cualquier profundidad) y un salto de línea final; sin fechas de ejecución. */
export function serializar(valor: unknown): string {
  const ordenar = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(ordenar);
    if (typeof x === 'object' && x !== null) {
      return Object.fromEntries(Object.keys(x).sort().map((k) => [k, ordenar((x as Record<string, unknown>)[k])]));
    }
    return x;
  };
  return `${JSON.stringify(ordenar(valor), null, 2)}\n`;
}

/** Diff legible: las primeras líneas que difieren, con su número. */
export function diferencias(esperado: string, actual: string, maximo = 12): string {
  const a = esperado.split('\n');
  const b = actual.split('\n');
  const salida: string[] = [];
  for (let i = 0; i < Math.max(a.length, b.length) && salida.length < maximo; i += 1) {
    if (a[i] !== b[i]) salida.push(`  línea ${String(i + 1)}\n    referencia: ${JSON.stringify(a[i] ?? '(no existe)')}\n    actual:     ${JSON.stringify(b[i] ?? '(no existe)')}`);
  }
  return salida.join('\n');
}

/** Lee el archivo en una sola operación (sin comprobar antes si existe); `undefined` si no está. */
function leerSiExiste(ruta: string): string | undefined {
  try {
    return readFileSync(ruta, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
}

/**
 * Compara `contenido` (texto) con `referencias/<nombre>`. En modo de actualización escribe la referencia (solo si cambió).
 * En CI la actualización está prohibida.
 */
export function compararConFoto(nombre: string, contenido: string): void {
  const ruta = join(CARPETA_REFERENCIAS, nombre);
  if (actualizando()) {
    if (process.env['CI'] !== undefined && process.env['CI'] !== '') throw new Error('Las referencias de equivalencia no se regeneran en CI');
    mkdirSync(dirname(ruta), { recursive: true });
    if (leerSiExiste(ruta) !== contenido) writeFileSync(ruta, contenido);
    return;
  }
  const esperado = leerSiExiste(ruta);
  if (esperado === undefined) throw new Error(`falta la referencia ${nombre}; genérela con \`pnpm equivalencia:actualizar\` y explíquela en CAMBIOS.md`);
  if (esperado !== contenido) {
    throw new Error(`La salida cambió respecto de la referencia «${nombre}» (el tenant de referencia no debe cambiar en silencio):\n${diferencias(esperado, contenido)}`);
  }
}

/** Foto de un valor JSON. */
export const compararConFotoJson = (nombre: string, valor: unknown): void => compararConFoto(nombre, serializar(valor));
