import { PLANES } from '@plataforma/nucleo';

const MIB = 1024 * 1024;

/**
 * Límites de la propuesta. Los megabytes y gigabytes se miden en potencias de 2
 * (1 MB = 1 MiB): es la lectura que menos rechaza fotos legítimas de 15 MB.
 * Los topes de productos y usuarios no se repiten: salen de los planes del núcleo.
 */
export const LIMITES_CONSOLA = {
  productos: PLANES.base.productos,
  usuarios: PLANES.base.usuarios,
  fotosPorProducto: 5,
  videosPorProducto: 1,
  bytesFoto: 15 * MIB,
  bytesVideo: 200 * MIB,
  duracionVideoSeg: 60,
  cuotaOriginalesBytes: 10 * 1024 * MIB,
  /** Protección contra imágenes «bomba»: píxeles máximos de una foto (100 megapíxeles). */
  pixelesFotoMax: 100_000_000,
  seccionesMax: 5,
  /** Vigencia de una reserva de subida sin finalizar. */
  vigenciaReservaMs: 6 * 60 * 60 * 1000,
  /** Ventana de agrupación de cambios antes de reconstruir el sitio. */
  ventanaReconstruccionMs: 10 * 60 * 1000,
} as const;
