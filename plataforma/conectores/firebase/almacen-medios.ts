// `AlmacenMedios` de la consola sobre Cloud Storage. Las rutas son rutas de objeto dentro del bucket
// (`tenants/{t}/privado/...`); las versiones publicadas van a `tenants/{t}/publico/medios/...` con caché inmutable.
import { createHash } from 'node:crypto';
import type { Storage } from 'firebase-admin/storage';
import type { AlmacenMedios } from '@novutienda/consola';
import { esTenantIdValido } from '@novutienda/nucleo';

export type Bucket = ReturnType<Storage['bucket']>;

export const CACHE_INMUTABLE = 'public, max-age=31536000, immutable';

const TIPOS: Readonly<Record<string, string>> = {
  avif: 'image/avif',
  webp: 'image/webp',
  mp4: 'video/mp4',
};

/** Tipo de contenido de una ruta pública según su extensión (las versiones las nombra la consola). */
export const tipoContenidoDe = (ruta: string): string => TIPOS[ruta.slice(ruta.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';

/**
 * Única ruta que puede llegar al bucket público: las versiones publicadas de un tenant, con la forma exacta que produce la
 * consola (`rutaPublicaMedio` + `nombreVersion`): `tenants/<t>/publico/medios/<producto>/<hash32>-<clase><lado>.<formato>`.
 * Todo lo demás (originales, temporales, PDF de recibos) vive solo en el bucket por defecto. La ruta se ancla completa:
 * sin `..`, `//`, `%`, mayúsculas ni segmentos extra. El tenant se valida con `esTenantIdValido` del núcleo (una sola definición);
 * el producto replica `ID_PRODUCTO` y la versión replica `nombreVersion`/`planificarProcesamiento` de `@novutienda/consola`,
 * que este conector no puede importar sin crear un cruce.
 */
const RUTA_PUBLICA_COMPLETA = /^tenants\/([^/]+)\/publico\/medios\/[a-z0-9][a-z0-9-]{1,59}\/[a-f0-9]{32}-(?:imagen[1-9][0-9]{0,4}\.(?:avif|webp)|video[1-9][0-9]{0,4}\.mp4|poster[1-9][0-9]{0,4}\.webp)$/;
export const RUTA_PUBLICA = {
  test(ruta: string): boolean {
    const m = RUTA_PUBLICA_COMPLETA.exec(ruta);
    return m !== null && esTenantIdValido(m[1]);
  },
};

/**
 * `bucket` guarda originales, temporales y recibos; `publico` (un bucket aparte, legible por URL) recibe SOLO las versiones
 * publicadas. Si `publico === bucket` (emulador y pruebas) todo ocurre en un único bucket.
 */
export function crearAlmacenMedios(bucket: Bucket, publico: Bucket = bucket): AlmacenMedios {
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
      if (!RUTA_PUBLICA.test(destino)) throw new Error('destino de publicación fuera de tenants/<tenant>/publico/medios/');
      // Una sola operación: la copia nace con su caché inmutable y su tipo.
      await bucket.file(origen).copy(publico.file(destino), { cacheControl: CACHE_INMUTABLE, contentType: tipoContenidoDe(destino) });
    },

    async borrar(rutas) {
      await Promise.all(
        rutas.map(async (r) => {
          if (!RUTA_PUBLICA.test(r)) return bucket.file(r).delete({ ignoreNotFound: true });
          await publico.file(r).delete({ ignoreNotFound: true });
          // Legado: antes de separar los buckets las versiones se copiaban en el bucket por defecto; se limpian medio por medio.
          if (publico !== bucket) await bucket.file(r).delete({ ignoreNotFound: true });
        }),
      );
    },
  };
}
