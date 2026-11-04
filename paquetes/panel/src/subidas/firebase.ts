import { getApp } from 'firebase/app';
import { getStorage, ref, uploadBytesResumable } from 'firebase/storage';
import type { AlmacenSubidas } from './almacen.js';

/** Subida reanudable real (Firebase Storage) a la ruta privada de la reserva. */
export class AlmacenSubidasFirebase implements AlmacenSubidas {
  subir(ruta: string, archivo: Blob, alProgresar: (porcentaje: number) => void): Promise<void> {
    return new Promise((resolver, rechazar) => {
      const tarea = uploadBytesResumable(ref(getStorage(getApp()), ruta), archivo);
      tarea.on(
        'state_changed',
        (s) => alProgresar(s.totalBytes === 0 ? 0 : Math.round((s.bytesTransferred / s.totalBytes) * 100)),
        (e) => rechazar(e),
        () => resolver(),
      );
    });
  }
}
