// Adaptador de `BaseDatosIdentidad` sobre Firestore (firebase-admin). Es la base transaccional que usan TODOS
// los módulos: la transacción de Firestore es serializable y el SDK la reintenta ante contención, así que la
// función que recibe `runTransaction` debe ser pura salvo por las escrituras que pide a la transacción.
//
// Reglas de Firestore que el adaptador no puede ocultar: las lecturas van ANTES de las escrituras (el SDK
// lanza si se invierte el orden) y `create` falla si el documento ya existe.
import { FieldValue, type DocumentSnapshot, type Firestore, type Transaction } from 'firebase-admin/firestore';
import type { BaseDatosIdentidad, TransaccionIdentidad } from '@novutienda/nucleo';
import type { DocumentoListado, LectorColecciones } from '../../coordinador/colecciones.js';

type Datos = Readonly<Record<string, unknown>>;

/** Quita las claves `undefined` (Firestore las rechaza); los módulos no las envían, pero el borde no confía. */
function limpiar(datos: Datos): Record<string, unknown> {
  const salida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(datos)) if (v !== undefined) salida[k] = v;
  return salida;
}

class TransaccionFirestore implements TransaccionIdentidad {
  constructor(
    private readonly db: Firestore,
    private readonly tx: Transaction,
  ) {}

  async get(ruta: string): Promise<{ readonly existe: boolean; data(): Datos | undefined }> {
    const snap: DocumentSnapshot = await this.tx.get(this.db.doc(ruta));
    return { existe: snap.exists, data: () => snap.data() };
  }

  set(ruta: string, datos: Datos): void {
    this.tx.set(this.db.doc(ruta), limpiar(datos));
  }

  create(ruta: string, datos: Datos): void {
    this.tx.create(this.db.doc(ruta), limpiar(datos));
  }

  delete(ruta: string): void {
    this.tx.delete(this.db.doc(ruta));
  }

  nuevoId(rutaColeccion: string): string {
    return this.db.collection(rutaColeccion).doc().id;
  }

  marcaTiempoServidor(): unknown {
    return FieldValue.serverTimestamp();
  }
}

/** Base de datos de la plataforma: transacciones y lectura de colecciones completas. */
export interface BaseDatosFirestore extends BaseDatosIdentidad, LectorColecciones {
  readonly firestore: Firestore;
}

export function crearBaseDatos(firestore: Firestore): BaseDatosFirestore {
  return {
    firestore,
    runTransaction: <T>(fn: (tx: TransaccionIdentidad) => Promise<T>): Promise<T> =>
      firestore.runTransaction((tx) => fn(new TransaccionFirestore(firestore, tx))),
    async listar(rutaColeccion: string): Promise<readonly DocumentoListado[]> {
      const snap = await firestore.collection(rutaColeccion).get();
      return snap.docs.map((d) => ({ id: d.id, datos: d.data() }));
    },
  };
}
