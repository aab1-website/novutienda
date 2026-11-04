// `LimiteTasa` sobre Firestore: ventana fija por clave. La clave (que incluye la IP) se guarda como hash
// SHA-256 salado: la colección no contiene direcciones IP. Los documentos llevan `expiraEn` para que la
// política TTL de Firestore (ver `firestore.indexes.json`) los borre sola.
import { createHash } from 'node:crypto';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { LimiteTasa } from '@novutienda/website';

export const COLECCION_LIMITES = 'limitesTasa';

export function hashClave(clave: string, sal: string): string {
  return createHash('sha256').update(`${sal}\u0000${clave}`).digest('hex');
}

export function crearLimiteTasa(
  firestore: Firestore,
  opciones: { readonly maximo: number; readonly ventanaMs: number; readonly sal: string },
): LimiteTasa {
  if (!Number.isInteger(opciones.maximo) || opciones.maximo < 1 || !Number.isInteger(opciones.ventanaMs) || opciones.ventanaMs < 1000) {
    throw new RangeError('maximo y ventanaMs inválidos');
  }
  return {
    intentar(clave, ahoraMs) {
      const ref = firestore.collection(COLECCION_LIMITES).doc(hashClave(clave, opciones.sal));
      return firestore.runTransaction(async (tx) => {
        const d = await tx.get(ref);
        const inicio = d.exists ? Number(d.get('inicio')) : NaN;
        const vigente = Number.isFinite(inicio) && ahoraMs - inicio < opciones.ventanaMs;
        const usos = vigente ? Number(d.get('usos')) + 1 : 1;
        const desde = vigente ? inicio : ahoraMs;
        tx.set(ref, { inicio: desde, usos, expiraEn: Timestamp.fromMillis(desde + opciones.ventanaMs * 2) });
        const permitido = usos <= opciones.maximo;
        return { permitido, reintentarEnSeg: permitido ? 0 : Math.max(1, Math.ceil((desde + opciones.ventanaMs - ahoraMs) / 1000)) };
      });
    },
  };
}
