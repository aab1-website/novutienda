// Une lo que declara el registro (roles y `propietario` de cada acción, horario de cada programada) con lo que
// implementa el servidor (esquema y ejecución). El permiso vive en el manifiesto del módulo y en un solo lugar; el
// borde (`llamadas/<m>.ts`) solo trae el esquema y la lógica. Si el registro y los bordes no coinciden, el arranque
// falla: ninguna acción queda sin permiso declarado ni con un permiso sin implementación.
import { registroPlataforma } from '../registro.js';
import type { Rol } from '@novutienda/nucleo';

// Genérico a propósito: el coordinador no importa el marco del servidor (el proyecto de TypeScript de `plataforma` excluye `funciones`).
// El registro valida los roles de cada acción contra los del núcleo al registrar el manifiesto.
/** Permisos que el registro aporta a una implementación. */
export interface Permisos {
  readonly roles: readonly Rol[];
  readonly propietario: boolean;
}

/** Lo mínimo del registro que se necesita (acepta el real o un doble de prueba). */
export type FuenteDeManifiestos = Pick<typeof registroPlataforma, 'acciones' | 'programadas'>;

/**
 * Tabla final del callable: las acciones del registro con ese `callable`, cada una con su implementación.
 * Lanza si el registro declara una acción sin implementación o si hay una implementación sin declarar.
 */
export function tablaDeCallable<I extends object>(
  callable: string,
  implementaciones: Readonly<Record<string, I>>,
  fuente: FuenteDeManifiestos = registroPlataforma,
): Readonly<Record<string, I & Permisos>> {
  const declaradas = fuente.acciones().filter((a) => a.callable === callable);
  const tabla: Record<string, I & Permisos> = {};
  const faltan: string[] = [];
  for (const d of declaradas) {
    const impl = Object.hasOwn(implementaciones, d.nombre) ? implementaciones[d.nombre] : undefined;
    if (impl === undefined) {
      faltan.push(d.nombre);
      continue;
    }
    tabla[d.nombre] = { ...impl, roles: d.roles as readonly Rol[], propietario: d.propietario === true };
  }
  const nombres = new Set(declaradas.map((d) => d.nombre));
  const sobran = Object.keys(implementaciones).filter((n) => !nombres.has(n));
  if (faltan.length > 0 || sobran.length > 0) {
    const partes = [
      faltan.length > 0 ? `declaradas en el manifiesto sin implementación: ${faltan.join(', ')}` : '',
      sobran.length > 0 ? `implementadas sin declarar en el manifiesto: ${sobran.join(', ')}` : '',
    ].filter((p) => p !== '');
    throw new Error(`Callable ${callable}: ${partes.join('; ')}`);
  }
  return tabla;
}

/** `schedule` y `timeZone` de una programada, tomados del registro. Lanza si el registro no la declara. */
export function horarioDe(id: string, fuente: FuenteDeManifiestos = registroPlataforma): { readonly schedule: string; readonly timeZone: string } {
  const p = fuente.programadas().find((x) => x.id === id);
  if (p === undefined) throw new Error(`La programada ${id} no está declarada en ningún manifiesto`);
  return { schedule: p.horario, timeZone: p.zonaHoraria };
}
