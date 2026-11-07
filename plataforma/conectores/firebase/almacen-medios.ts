// `AlmacenMedios` de la consola sobre Cloud Storage. Las rutas son rutas de objeto dentro del bucket
// (`tenants/{t}/privado/...`); las versiones publicadas van a `tenants/{t}/publico/medios/...` con caché inmutable.
import { createHash } from 'node:crypto';
import type { Storage } from 'firebase-admin/storage';
import type { AlmacenMedios } from '@novutienda/consola';

export type Bucket = ReturnType<Storage['bucket']>;

export const CACHE_INMUTABLE = 'public, max-age=31536000, immutable';

const TIPOS: Readonly<Record<string, string>> = {
  avif: 'image/avif',
  webp: 'image/webp',
  mp4: 'video/mp4',
};

/** Tipo de contenido de una ruta pública según su extensión (las versiones las nombra la consola). */
export const tipoContenidoDe = (ruta: string): string => TIPOS[ruta.slice(ruta.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';

export function crearAlmacenMedios(bucket: Bucket): AlmacenMedios {
  return {
    async tamano(ruta) {
      const archivo = bucket.file(ruta);
      const [existe] = await archivo.exists();
      if (!existe) return undefined;
      const [meta] = await archivo.getMetadata();
      const n = Number(meta.size);
      return Number.isFinite(n) ? n : undefined;
    },

    async leerInicio(ruta, n) {
      if (!Number.isInteger(n) || n < 1) throw new RangeError('n debe ser un entero positivo');
      const [bytes] = await bucket.file(ruta).download({ start: 0, end: n - 1 });
      return new Uint8Array(bytes);
    },

    async hashContenido(ruta) {
      const hash = createHash('sha256');
      for await (const trozo of bucket.file(ruta).createReadStream()) hash.update(trozo as Buffer);
      return hash.digest('hex');
    },

    async publicar(origen, destino) {
      const [copia] = await bucket.file(origen).copy(bucket.file(destino));
      await copia.setMetadata({ cacheControl: CACHE_INMUTABLE, contentType: tipoContenidoDe(destino) });
    },

    async borrar(rutas) {
      await Promise.all(rutas.map((r) => bucket.file(r).delete({ ignoreNotFound: true })));
    },
  };
}
