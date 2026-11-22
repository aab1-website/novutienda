// `AlmacenVistas` del sitio sobre `tenants/{t}/vistasProducto/{id}`. Solo cuentan los productos que están en `publicado`
// (`publicado/producto__{id}`), para que nadie infle ids inventados. El contador es un incremento atómico; no se guarda
// ninguna IP ni identificador de persona.
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import type { AlmacenVistas } from '@novutienda/website';

export function crearAlmacenVistas(firestore: Firestore, tenantId: string): AlmacenVistas {
  const base = `tenants/${tenantId}`;
  const publicado = async (id: string): Promise<boolean> => (await firestore.doc(`${base}/publicado/producto__${id}`).get()).exists;
  const contador = (id: string) => firestore.doc(`${base}/vistasProducto/${id}`);
  return {
    async leer(id) {
      if (!(await publicado(id))) return null;
      const v: unknown = (await contador(id).get()).get('vistas');
      return typeof v === 'number' ? v : 0;
    },
    async sumar(id) {
      if (!(await publicado(id))) return null;
      const ref = contador(id);
      await ref.set({ vistas: FieldValue.increment(1) }, { merge: true });
      const v: unknown = (await ref.get()).get('vistas');
      return typeof v === 'number' ? v : 1;
    },
  };
}
