/**
 * Modelo tipado del contenido del sitio público. Es la ÚNICA forma en que el
 * sitio recibe datos: la reconstrucción entrega una copia validada de `publicado/`
 * (fichas, secciones, configuración) y el sitio no lee Firestore desde el navegador.
 *
 * Los precios se guardan en USD por mercado; el precio final lo calcula `precioFinal`
 * del núcleo con la cotización oficial. Un precio base 0 significa «consultar».
 */
import type { Mercado, Redondeo } from '@plataforma/nucleo';

/** Lista cerrada de plantillas de color (ver `plantillas/plantillas.ts`). */
export const IDS_PLANTILLA = ['cielo', 'bosque', 'ambar', 'grafito', 'ciruela'] as const;
export type IdPlantilla = (typeof IDS_PLANTILLA)[number];

/** Íconos de categoría y de beneficios disponibles (lista cerrada, sin SVG libre). */
export const IDS_ICONO = [
  'parlante', 'microondas', 'televisor', 'lavadora', 'aire', 'congelador', 'heladera', 'cuadricula',
  'escudo', 'camion', 'mensaje', 'tendencia', 'usuario', 'check', 'pin', 'telefono', 'actualizar',
] as const;
export type IdIcono = (typeof IDS_ICONO)[number];

/** Límites de la propuesta comercial (fuente: docs/modulos/website.md). */
export const LIMITES_SITIO = {
  productos: 200,
  fotosPorProducto: 5,
  videosPorProducto: 1,
  secciones: 5,
  bloquesPorSeccion: 12,
  fotosPorCarrusel: 8,
  carruselesPorPlantilla: 8,
} as const;

export interface Foto {
  /** Ruta o URL de la versión por defecto (pantalla grande). */
  readonly url: string;
  readonly alt: string;
  /** Versiones por ancho (WebP/AVIF), si existen. */
  readonly versiones?: readonly { readonly url: string; readonly ancho: number }[];
}

export interface Video {
  readonly url: string;
  readonly poster: string;
  readonly titulo: string;
}

export interface Categoria {
  readonly id: string;
  readonly nombre: string;
  readonly icono: IdIcono;
}

export interface Producto {
  /** Mismo identificador que el producto de Inventarios: `^[a-z0-9][a-z0-9-]{1,59}$`. */
  readonly id: string;
  readonly slug: string;
  readonly nombre: string;
  readonly categoria: string;
  readonly marca: string;
  readonly descripcion: string;
  readonly garantia: string | null;
  /** USD por mercado; 0 = «consultar». */
  readonly precioUsd: Readonly<Record<Mercado, number>>;
  /** Disponibilidad al momento de la reconstrucción; la ficha la refresca con `/api/disponibilidad`. */
  readonly disponible: boolean;
  readonly fotos: readonly Foto[];
  readonly video: Video | null;
  readonly destacado: boolean;
  readonly seo: { readonly titulo?: string; readonly descripcion?: string };
}

/** Una afirmación comercial que puede estar sin confirmar. No se publica hasta confirmarla. */
export interface Afirmacion {
  readonly texto: string;
  readonly confirmada: boolean;
}

export interface Beneficio {
  readonly icono: IdIcono;
  readonly titulo: Afirmacion;
  readonly descripcion: string;
}

export interface Valor {
  readonly icono: IdIcono;
  readonly titulo: string;
  readonly texto: string;
}

export interface Identidad {
  readonly etiqueta: string;
  readonly titulo: string;
  readonly texto: string;
  readonly foto: Foto | null;
  /** Cifra destacada sobre la foto (por ejemplo, número de clientes). Sin confirmar no se muestra. */
  readonly cifra: { readonly valor: Afirmacion; readonly detalle: string } | null;
  readonly valores: readonly Valor[];
  readonly sello: Afirmacion;
}

export interface Portada {
  readonly insignia: string;
  /** Líneas del título: la primera clara, la segunda atenuada y la tercera con el acento. */
  readonly titulo: readonly [string, string, string];
  readonly texto: string;
  readonly textoBotonCatalogo: string;
  readonly textoBotonConsulta: string;
}

export type Bloque =
  | { readonly tipo: 'texto'; readonly titulo?: string; readonly parrafos: readonly string[] }
  | { readonly tipo: 'imagen'; readonly foto: Foto }
  | { readonly tipo: 'carrusel'; readonly fotos: readonly Foto[] }
  | { readonly tipo: 'enlaces'; readonly titulo?: string; readonly items: readonly { readonly texto: string; readonly url: string }[] };

export interface Seccion {
  readonly id: string;
  readonly slug: string;
  readonly titulo: string;
  readonly orden: number;
  readonly bloques: readonly Bloque[];
}

export interface ConfigMedicion {
  /** Etiqueta de Google (por ejemplo `G-XXXXXXXXXX`). */
  readonly google: string | null;
  /** Código de verificación de Search Console (etiqueta meta, no hace peticiones). */
  readonly searchConsole: string | null;
  readonly meta: string | null;
  readonly tiktok: string | null;
}

export interface ConfigSitio {
  readonly nombre: string;
  readonly lema: string;
  /** Origen público del sitio (https://…), para URL canónicas y JSON-LD. */
  readonly origen: string;
  readonly plantilla: IdPlantilla;
  /** Número del asistente de NovuChat (solo dígitos, con código de país), o null si no está configurado. */
  readonly whatsappNovuchat: string | null;
  /** Número de la tienda para el carrito de consulta y el pie, o null. */
  readonly whatsappTienda: string | null;
  readonly telefono: string | null;
  readonly correo: string | null;
  readonly direccion: string;
  readonly horario: string | null;
  readonly mercados: readonly Mercado[];
  readonly mercadoInicial: Mercado;
  /** Regla de redondeo del precio final por moneda: es política del negocio, vive en la configuración. */
  readonly redondeo: Redondeo;
  readonly medicion: ConfigMedicion;
  readonly recaptchaSiteKey: string | null;
  /** Origen de los medios públicos (Storage/CDN propio), si no es el mismo origen del sitio. */
  readonly origenMedios: string | null;
  /** Anfitriones https permitidos en los enlaces de las secciones editables. */
  readonly enlacesPermitidos: readonly string[];
  readonly textoPrivacidad: readonly string[];
  /** Marca de ejemplo: el sitio muestra un aviso y no se indexa. */
  readonly esEjemplo: boolean;
}

export interface Contenido {
  readonly config: ConfigSitio;
  readonly portada: Portada;
  readonly beneficios: readonly Beneficio[];
  readonly categorias: readonly Categoria[];
  readonly marcas: readonly string[];
  readonly identidad: Identidad;
  readonly productos: readonly Producto[];
  readonly secciones: readonly Seccion[];
  /** Fotos del carrusel de la portada, por plantilla. */
  readonly carruseles: Readonly<Record<IdPlantilla, readonly Foto[]>>;
}
