// Doble mínimo de la API de lectura de `firebase-admin/firestore` (collection/where/get, doc/get, getAll) sobre el
// `DobleDb` de las pruebas de integración. Solo lo que usan los bordes HTTP de NovuChat y del sitio. Permite
// ejercitar esos manejadores reales sin emulador: lo que necesite el emulador va a `pnpm test:funciones`.
import type { Firestore } from 'firebase-admin/firestore';
import type { DobleDb } from '../integracion/doble-db.js';

type Datos = Readonly<Record<string, unknown>>;

interface Instantanea {
  readonly id: string;
  readonly exists: boolean;
  data(): Datos | undefined;
  get(campo: string): unknown;
}

const instantanea = (ruta: string, datos: Datos | undefined): Instantanea => ({
  id: ruta.slice(ruta.lastIndexOf('/') + 1),
  exists: datos !== undefined,
  data: () => datos,
  get: (campo) => datos?.[campo],
});

class Consulta {
  constructor(private readonly db: DobleDb, private readonly ruta: string, private readonly filtros: readonly (readonly [string, unknown])[] = []) {}

  where(campo: string, operador: string, valor: unknown): Consulta {
    if (operador !== '==') throw new Error(`el doble solo admite '==' (recibió ${operador})`);
    return new Consulta(this.db, this.ruta, [...this.filtros, [campo, valor]]);
  }

  doc(id: string): { get(): Promise<Instantanea> } {
    const ruta = `${this.ruta}/${id}`;
    return { get: () => Promise.resolve(instantanea(ruta, this.db.dato(ruta))) };
  }

  get(): Promise<{ docs: Instantanea[] }> {
    const docs = this.db
      .coleccion(this.ruta)
      .filter((d) => this.filtros.every(([campo, valor]) => d.datos[campo] === valor))
      .map((d) => instantanea(d.ruta, d.datos))
      .sort((a, b) => a.id.localeCompare(b.id));
    return Promise.resolve({ docs });
  }
}

/** Firestore de solo lectura sobre el doble. Los resultados salen ordenados por id (el real no garantiza orden sin `orderBy`). */
export function firestoreDoble(db: DobleDb): Firestore {
  const f = {
    collection: (ruta: string) => new Consulta(db, ruta),
    doc: (ruta: string) => ({ id: ruta.slice(ruta.lastIndexOf('/') + 1), path: ruta, get: () => Promise.resolve(instantanea(ruta, db.dato(ruta))) }),
    getAll: (...args: unknown[]) =>
      Promise.resolve(args.filter((a): a is { path: string } => typeof a === 'object' && a !== null && 'path' in a).map((r) => instantanea(r.path, db.dato(r.path)))),
  };
  return f as unknown as Firestore;
}
