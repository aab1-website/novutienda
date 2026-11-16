import { PLANES } from '@novutienda/nucleo';

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
  /** Logo del negocio: tope del archivo subido y lado mayor de las versiones publicadas. */
  bytesLogo: 2 * MIB,
  ladoLogo: 512,
  /** Píxeles máximos del logo (25 megapíxeles; las fotos conservan su tope de 100). */
  pixelesLogoMax: 25_000_000,
  /** Reservas de logo permitidas por hora y por comercio. */
  logosPorHora: 10,
  duracionVideoSeg: 60,
  cuotaOriginalesBytes: 10 * 1024 * MIB,
  /** Protección contra imágenes «bomba»: píxeles máximos de una foto (100 megapíxeles). */
  pixelesFotoMax: 100_000_000,
  /** Protección de recursos al transcodificar: lado máximo y área máxima (4096×2304) de un video. */
  ladoVideoMax: 4096,
  pixelesVideoMax: 4096 * 2304,
  seccionesMax: 5,
  /** Vigencia de una reserva de subida sin finalizar. */
  vigenciaReservaMs: 6 * 60 * 60 * 1000,
  /** Tiempo que una invocación puede tener reclamada una subida (`procesando`) antes de que otra la retome; debe superar el timeout máximo de la función (540 s). */
  vencimientoProcesandoMs: 10 * 60 * 1000,
  /** Ventana de agrupación de cambios antes de reconstruir el sitio. */
  ventanaReconstruccionMs: 10 * 60 * 1000,
  /** Espera antes de borrar las versiones PÚBLICAS de un logo reemplazado o quitado: el sitio ya construido aún puede estar usándolas. */
  esperaBorradoLogoMs: 24 * 60 * 60 * 1000,
} as const;
