// Encendido por tenant (L2-1): funciones puras, sin efecto sobre reglas ni rutas.
import { NO_ENCENDIBLES } from '../registro/registro.js';
import type { IdModulo, ManifiestoModulo } from '../registro/tipos.js';

const noEncendibles: readonly string[] = NO_ENCENDIBLES;

/** Dependencias a evaluar: las de NO_ENCENDIBLES siempre están satisfechas y no cuentan. */
/** Índice por id; lanza si dos manifiestos comparten id (ambigüedad). */
function indexar(manifiestos: readonly ManifiestoModulo[]): Map<IdModulo, ManifiestoModulo> {
  const porId = new Map<IdModulo, ManifiestoModulo>();
  for (const m of manifiestos) {
    if (porId.has(m.id)) throw new Error(`Manifiesto repetido: ${m.id}`);
    porId.set(m.id, m);
  }
  return porId;
}

function dependencias(m: ManifiestoModulo): IdModulo[] {
  return [...m.dependeDe, ...(m.requiere ?? [])].filter((d) => !noEncendibles.includes(d));
}

/**
 * Módulos efectivos: encendidos y con toda su cadena de `dependeDe` y `requiere`
 * también encendida (cierre transitivo). Los ids de NO_ENCENDIBLES nunca lo son.
 * Conserva el orden de `encendidos`, sin repetidos.
 */
export function modulosEfectivos(manifiestos: readonly ManifiestoModulo[], encendidos: readonly IdModulo[]): IdModulo[] {
  const porId = indexar(manifiestos);
  const on = new Set(encendidos.filter((id) => typeof id === 'string' && !noEncendibles.includes(id) && porId.has(id)));
  // Se retiran los que tienen una dependencia fuera, hasta que no cambie nada (maneja cadenas y ciclos).
  let cambio = true;
  while (cambio) {
    cambio = false;
    for (const id of [...on]) {
      const m = porId.get(id);
      if (m !== undefined && dependencias(m).some((d) => !on.has(d))) {
        on.delete(id);
        cambio = true;
      }
    }
  }
  return [...new Set(encendidos)].filter((id) => on.has(id));
}

/** Valida una lista de encendidos: ids desconocidos, no encendibles y dependencias faltantes. */
export function validarEncendido(
  manifiestos: readonly ManifiestoModulo[],
  encendidos: readonly IdModulo[],
): { ok: true } | { ok: false; errores: string[] } {
  const errores: string[] = [];
  const porId = new Map<IdModulo, ManifiestoModulo>();
  for (const m of manifiestos) {
    if (porId.has(m.id)) errores.push(`Manifiesto repetido: ${m.id}`);
    else porId.set(m.id, m);
  }
  if (errores.length > 0) return { ok: false, errores };
  const set = new Set<IdModulo>();
  for (const id of encendidos) {
    if (typeof id !== 'string') errores.push('Id de módulo no es texto');
    else set.add(id);
  }
  for (const id of set) {
    if (noEncendibles.includes(id)) errores.push(`${id} no es encendible`);
    else if (!porId.has(id)) errores.push(`${id} es un módulo desconocido`);
  }
  for (const id of set) {
    const m = porId.get(id);
    if (m === undefined || noEncendibles.includes(id)) continue;
    for (const d of new Set(dependencias(m))) {
      if (!set.has(d)) errores.push(`${id} requiere ${d}, que no está encendido`);
    }
  }
  return errores.length === 0 ? { ok: true } : { ok: false, errores };
}
