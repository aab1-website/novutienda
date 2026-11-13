// Sello de las referencias: SHA-256 de los nombres y contenidos de todos los archivos de `referencias/` (menos el sello
// mismo). Lo escribe `pnpm equivalencia:actualizar` junto con una entrada pendiente en CAMBIOS.md; `registro.test.ts`
// exige que el sello guardado coincida con las referencias y que CAMBIOS.md explique el último cambio.
// Solo usa `node:`: lo carga también `actualizar.mjs` con el stripping de tipos de Node.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const ARCHIVO_SELLO = 'SELLO';

export function calcularSello(carpeta: string): string {
  const hash = createHash('sha256');
  for (const nombre of readdirSync(carpeta).filter((n) => n !== ARCHIVO_SELLO).sort()) {
    hash.update(`${nombre}\0`);
    hash.update(readFileSync(join(carpeta, nombre)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function leerSello(carpeta: string): string | undefined {
  const ruta = join(carpeta, ARCHIVO_SELLO);
  return existsSync(ruta) ? readFileSync(ruta, 'utf8').trim() : undefined;
}

export interface EntradaCambios {
  readonly sello: string;
  readonly motivo: string;
}

/** Entradas de CAMBIOS.md: bloques `## …` con una línea `Sello: <hex>` y otra `Motivo: <texto>` (puede seguir en varias líneas). */
export function leerCambios(markdown: string): EntradaCambios[] {
  return markdown
    .split(/^## /m)
    .slice(1)
    .flatMap((bloque) => {
      const sello = /^Sello: ([0-9a-f]{64})\s*$/m.exec(bloque)?.[1];
      const motivo = /^Motivo: ([\s\S]*)$/m.exec(bloque)?.[1]?.trim();
      return sello === undefined || motivo === undefined ? [] : [{ sello, motivo }];
    });
}
