// Puertos inyectables de la consola. Inventarios (productos, precios, stock) y la
// infraestructura (Storage, procesamiento, programación) los implementan; aquí solo
// se declara el contrato. La consola no importa ningún otro módulo.
import type { BaseDatosIdentidad } from '@plataforma/nucleo';
import type { PlanProcesamiento } from './medios/plan.js';
import type { TipoMedio } from './medios/tipos-archivo.js';

/** Base de datos con transacciones serializables (la misma forma que usa la identidad del núcleo). */
export type BaseDatosConsola = BaseDatosIdentidad;

export interface Reloj {
  /** Milisegundos desde 1970. */
  ahora(): number;
}

export type UbicacionId = 'tienda' | 'deposito-1' | 'deposito-2';

/** Precio base en USD por mercado; 0 significa «sin precio / a consultar». */
export interface PrecioUSD {
  readonly bo: number;
  readonly ar: number;
}

/** Datos del producto que la consola puede editar (los escribe Inventarios). */
export interface DatosProducto {
  readonly nombre: string;
  readonly categoria: string;
  readonly marca?: string;
  readonly sku?: string;
  readonly activo: boolean;
  readonly garantiaMeses?: number;
}

export interface ProductoCatalogo extends DatosProducto {
  readonly id: string;
  readonly precioUSD: PrecioUSD;
  /** Ausente: el producto no controla stock. */
  readonly stockTotal?: number;
}

export interface Existencia {
  readonly ubicacionId: UbicacionId;
  readonly cantidad: number;
}

/**
 * Productos, precios y stock. Los implementa Inventarios con SUS funciones (la
 * consola nunca escribe esas colecciones). `crearProducto` debe reservar el tope
 * de 200 productos dentro de su propia transacción (`verificarYReservar` del núcleo)
 * y lanzar `LimiteDelPlan` si se supera.
 */
export interface CatalogoPuerto {
  listarProductos(tenantId: string): Promise<readonly ProductoCatalogo[]>;
  leerProducto(tenantId: string, productoId: string): Promise<ProductoCatalogo | undefined>;
  crearProducto(
    tenantId: string,
    productoId: string,
    datos: DatosProducto,
    precioUSD: PrecioUSD,
    por: string,
  ): Promise<void>;
  actualizarDatosProducto(tenantId: string, productoId: string, cambios: Partial<DatosProducto>, por: string): Promise<void>;
  actualizarPrecioUSD(tenantId: string, productoId: string, precio: PrecioUSD, por: string): Promise<void>;
  /** Solo lectura. */
  existenciasPorAlmacen(tenantId: string, productoId: string): Promise<readonly Existencia[]>;
}

/** Almacenamiento de objetos (Storage), por ruta. */
export interface AlmacenMedios {
  /** Tamaño en bytes, o undefined si el objeto no existe. */
  tamano(ruta: string): Promise<number | undefined>;
  /** Primeros `n` bytes (o menos si el objeto es más corto). */
  leerInicio(ruta: string, n: number): Promise<Uint8Array>;
  /** SHA-256 hexadecimal (64 caracteres) del contenido. */
  hashContenido(ruta: string): Promise<string>;
  /** Copia `origen` a `destino` en la zona pública con caché inmutable. */
  publicar(origen: string, destino: string): Promise<void>;
  /** Borra los objetos; los que no existen se ignoran. */
  borrar(rutas: readonly string[]): Promise<void>;
}

export interface InfoMedio {
  readonly ancho: number;
  readonly alto: number;
  /** Solo videos. */
  readonly duracionSeg?: number;
}

export interface VersionProcesada {
  readonly clase: 'imagen' | 'video' | 'poster';
  readonly lado: number;
  readonly formato: 'avif' | 'webp' | 'mp4';
  /** Ruta temporal privada donde dejó el resultado. */
  readonly rutaTemporal: string;
}

export interface SolicitudProcesado {
  readonly origen: string;
  readonly tipo: TipoMedio;
  readonly plan: PlanProcesamiento;
  /** Carpeta privada donde dejar las versiones. */
  readonly destinoTemporal: string;
}

/** Procesamiento de medios (imágenes y video). Debe quitar EXIF/GPS de toda salida. */
export interface ProcesadorMedios {
  inspeccionar(ruta: string, tipo: TipoMedio): Promise<InfoMedio>;
  procesar(solicitud: SolicitudProcesado): Promise<readonly VersionProcesada[]>;
}

/** Consulta de subidas por estado (índice de Firestore). */
export interface ConsultaSubidas {
  listarPorEstado(
    tenantId: string,
    estado: 'reservada' | 'borrando',
    limite: number,
  ): Promise<readonly { readonly id: string; readonly data: Readonly<Record<string, unknown>> }[]>;
}

/** Programación y disparo de la reconstrucción del sitio (nada depende de la laptop). */
export interface DisparadorSitio {
  /** Agenda `reconstruir` para `para` (ms). Debe ser idempotente por (tenantId, para). */
  programar(tenantId: string, para: number): Promise<void>;
  /** Dispara la reconstrucción del sitio estático del tenant. */
  reconstruir(tenantId: string, version: number, motivo: 'publicacion' | 'diaria'): Promise<void>;
}

/** Lector de hojas de cálculo (.xlsx): primera hoja como matriz de texto. Lo implementa un adaptador. */
export interface LectorHojas {
  leerPrimeraHoja(bytes: Uint8Array): Promise<readonly (readonly string[])[]>;
}
