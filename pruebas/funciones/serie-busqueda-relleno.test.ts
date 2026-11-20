// Relleno de `serieBusqueda` (scripts/rellenar-serie-busqueda.mjs): normaliza igual que el módulo, la simulación no escribe y
// el relleno es idempotente. Firestore se reemplaza por un doble mínimo en memoria.
import { describe, expect, it } from 'vitest';
import { normalizarSerieBusqueda } from '@novutienda/inventarios';

interface Relleno {
  normalizarSerieBusqueda(s: string): string;
  rellenar(o: { firestore: unknown; tenant: string; escribir?: boolean; tamanoLote?: number }): Promise<{ revisadas: number; aActualizar: number; actualizadas: number; sinSerie: number }>;
}
const ruta = '../../scripts/rellenar-serie-busqueda.mjs';
const { normalizarSerieBusqueda: delScript, rellenar } = (await import(/* @vite-ignore */ ruta)) as Relleno;

type Doc = Record<string, unknown>;
/** Doble mínimo: `collection().orderBy().limit().startAfter().get()` y `batch().update().commit()`. */
function firestoreDoble(docs: Map<string, Doc>) {
  const ids = (): string[] => [...docs.keys()].sort();
  const ref = (id: string) => ({ id });
  const instantanea = (id: string) => ({ id, ref: ref(id), data: () => docs.get(id) as Doc });
  let lotes = 0;
  const doble = {
    collection: () => ({
      orderBy: () => {
        let tope = Infinity;
        let desde: string | undefined;
        const q = {
          limit: (n: number) => ((tope = n), q),
          startAfter: (d: { id: string }) => ((desde = d.id), q),
          get: () => {
            const lista = ids().filter((i) => desde === undefined || i > desde).slice(0, tope);
            return Promise.resolve({ empty: lista.length === 0, docs: lista.map(instantanea) });
          },
        };
        return q;
      },
    }),
    batch: () => {
      const pendientes: [string, Doc][] = [];
      return {
        update: (r: { id: string }, datos: Doc) => void pendientes.push([r.id, datos]),
        commit: () => {
          lotes += 1;
          for (const [id, datos] of pendientes) docs.set(id, { ...(docs.get(id) as Doc), ...datos });
          return Promise.resolve();
        },
      };
    },
  };
  return { doble, lotes: () => lotes };
}

const sembrar = (): Map<string, Doc> =>
  new Map<string, Doc>([
    ['p__ABC123', { serie: 'ABC123' }],
    ['p__abc124', { serie: 'abc124', serieBusqueda: 'abc124' }],
    ['p__Xyz-9', { serie: 'Xyz-9', serieBusqueda: 'otra-cosa' }],
    ['p__SN.01', { serie: 'SN.01' }],
    ['p__sin', { productoId: 'p' }],
  ]);

describe('rellenar serieBusqueda', () => {
  it('el script y el módulo normalizan igual', () => {
    for (const s of ['ABC123', 'abc', 'Xyz-9', 'SN.01_A', 'aBc-DeF']) expect(delScript(s)).toBe(normalizarSerieBusqueda(s));
  });

  it('la simulación cuenta y no escribe', async () => {
    const docs = sembrar();
    const antes = JSON.stringify([...docs]);
    const { doble, lotes } = firestoreDoble(docs);
    const c = await rellenar({ firestore: doble, tenant: 't1' });
    expect(c).toEqual({ revisadas: 5, aActualizar: 3, actualizadas: 0, sinSerie: 1 });
    expect(JSON.stringify([...docs])).toBe(antes);
    expect(lotes()).toBe(0);
  });

  it('con escribir deja el campo al día, en lotes, y repetirlo no cambia nada', async () => {
    const docs = sembrar();
    const { doble } = firestoreDoble(docs);
    const c = await rellenar({ firestore: doble, tenant: 't1', escribir: true, tamanoLote: 2 });
    expect(c).toMatchObject({ revisadas: 5, aActualizar: 3, actualizadas: 3 });
    expect(docs.get('p__ABC123')).toEqual({ serie: 'ABC123', serieBusqueda: 'abc123' });
    expect(docs.get('p__Xyz-9')).toEqual({ serie: 'Xyz-9', serieBusqueda: 'xyz-9' });
    expect(docs.get('p__sin')).toEqual({ productoId: 'p' });
    const otra = await rellenar({ firestore: doble, tenant: 't1', escribir: true });
    expect(otra).toMatchObject({ revisadas: 5, aActualizar: 0, actualizadas: 0 });
  });
});
