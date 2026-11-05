// Enlace https al PDF de un recibo, que Recibos exige para armar el mensaje de WhatsApp. Puerto con dos
// implementaciones: la real firma una URL temporal (v4, hasta 7 días) del PDF guardado en una ruta PRIVADA
// del bucket; la del emulador devuelve una URL ficticia (el emulador no firma). El PDF nunca queda público.
import type { Bucket } from '../../adaptadores/firebase/index.js';

export interface EmisorEnlacePdf {
  /** Guarda el PDF y devuelve una URL https que lo abre. */
  publicar(tenantId: string, reciboId: string, pdf: Uint8Array): Promise<string>;
}

export const VIGENCIA_ENLACE_MS = 7 * 24 * 60 * 60 * 1000 - 60_000;
const rutaPdf = (tenantId: string, reciboId: string): string => `tenants/${tenantId}/privado/recibos/${reciboId}.pdf`;

export function emisorEnlaceFirmado(bucket: Bucket, ahora: () => number): EmisorEnlacePdf {
  return {
    async publicar(tenantId, reciboId, pdf) {
      const archivo = bucket.file(rutaPdf(tenantId, reciboId));
      await archivo.save(Buffer.from(pdf), { contentType: 'application/pdf', resumable: false });
      const [url] = await archivo.getSignedUrl({ version: 'v4', action: 'read', expires: ahora() + VIGENCIA_ENLACE_MS });
      return url;
    },
  };
}

export function emisorEnlaceEmulador(bucket: Bucket): EmisorEnlacePdf {
  return {
    async publicar(tenantId, reciboId, pdf) {
      const ruta = rutaPdf(tenantId, reciboId);
      await bucket.file(ruta).save(Buffer.from(pdf), { contentType: 'application/pdf', resumable: false });
      return `https://storage.googleapis.com/${bucket.name}/${ruta}`;
    },
  };
}
