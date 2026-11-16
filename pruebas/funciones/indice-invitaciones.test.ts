// Adaptador del índice de invitaciones con un doble de Firestore (sin emulador): consultas y tenantId tomado de la ruta.
import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { crearIndiceInvitaciones } from '../../plataforma/conectores/firebase/index.js';

type Filtro = readonly [string, string, unknown];
interface Doc { readonly path: string; readonly datos: Record<string, unknown> }

function doble(docs: readonly Doc[]): { firestore: Firestore; consultas: { alcance: string; filtros: Filtro[] }[] } {
  const consultas: { alcance: string; filtros: Filtro[] }[] = [];
  const consulta = (alcance: string, regla: (d: Doc) => boolean) => {
    const filtros: Filtro[] = [];
    consultas.push({ alcance, filtros });
    const q = {
      where(campo: string, op: string, valor: unknown) {
        filtros.push([campo, op, valor]);
        return q;
      },
      limit: () => q,
      get: () => {
        const sel = docs.filter((d) => regla(d) && filtros.every(([c, , v]) => d.datos[c] === v));
        return Promise.resolve({ docs: sel.map((d) => ({ id: d.path.split('/').pop(), ref: { path: d.path } })) });
      },
    };
    return q;
  };
  const firestore = {
    collection: (ruta: string) => consulta(ruta, (d) => d.path.startsWith(`${ruta}/`) && d.path.split('/').length === ruta.split('/').length + 1),
    collectionGroup: (id: string) => consulta(`grupo:${id}`, (d) => d.path.split('/').at(-2) === id),
  } as unknown as Firestore;
  return { firestore, consultas };
}

const DOCS: Doc[] = [
  { path: 'tenants/a/miembros/u1', datos: { estado: 'invitado', uid: 'u1' } },
  { path: 'tenants/b/miembros/u1', datos: { estado: 'invitado', uid: 'u1' } },
  { path: 'tenants/a/miembros/u2', datos: { estado: 'invitado', uid: 'u2' } },
  { path: 'tenants/c/miembros/u1', datos: { estado: 'activo', uid: 'u1' } },
  { path: 'tenants/d/miembros/u3', datos: { estado: 'invitado', uid: 'u1', tenantId: 'a' } }, // miente sobre su uid y su tenant
  { path: 'tenants/e/otra/u1', datos: { estado: 'invitado', uid: 'u1' } },
];

describe('IndiceInvitaciones sobre Firestore (doble)', () => {
  it('tenantsDe: grupo `miembros` por uid y estado, con el tenant tomado de la ruta', async () => {
    const { firestore, consultas } = doble(DOCS);
    expect([...(await crearIndiceInvitaciones(firestore).tenantsDe('u1'))].sort()).toEqual(['a', 'b']);
    expect(consultas[0]?.alcance).toBe('grupo:miembros');
    expect(consultas[0]?.filtros).toEqual([['uid', '==', 'u1'], ['estado', '==', 'invitado']]);
  });

  it('tenantsDe ignora un documento cuya ruta no es tenants/{t}/miembros/{uid}', async () => {
    const { firestore } = doble([{ path: 'x/y/z/miembros/u1', datos: { estado: 'invitado', uid: 'u1' } }]);
    expect(await crearIndiceInvitaciones(firestore).tenantsDe('u1')).toEqual([]);
  });

  it('invitadosDe: solo los invitados de ese comercio', async () => {
    const { firestore, consultas } = doble(DOCS);
    expect([...(await crearIndiceInvitaciones(firestore).invitadosDe('a'))].sort()).toEqual(['u1', 'u2']);
    expect(consultas[0]?.alcance).toBe('tenants/a/miembros');
    expect(consultas[0]?.filtros).toEqual([['estado', '==', 'invitado']]);
  });
});
