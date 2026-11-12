// Puertos inyectables de la consola. Inventarios (productos, precios, stock) y la
// infraestructura (Storage, procesamiento, programación) los implementan; aquí solo
// se declara el contrato. La consola no importa ningún otro módulo.
import type { BaseDatosIdentidad, TransaccionIdentidad } from '@novutienda/nucleo';
import type { PlanProcesamiento } from './medios/plan.js';
import type { TipoMedio } from './medios/tipos-archivo.js';

/** Base de datos con transacciones serializables (la misma forma que usa la identidad del núcleo). */
export type BaseDatosConsola = BaseDatosIdentidad;

export interface Reloj {
  /** Milisegundos desde 1970. */
  ahora(): number;
}

export type UbicacionId = 'tienda' | 'deposito-1' | 'deposito-2';

/**
 * Precio base en USD por mercado; 0 significa «sin precio / a consultar».
 * UNIDAD: dólares DECIMALES (hasta 2 decimales) en toda la consola y en este puerto. Inventarios guarda centavos
 * enteros; la conversión vive solo en el adaptador del puerto, nunca en la consola.
 */
export interface PrecioUSD {
  readonly bo: number;
  readonly ar: number;
}

/**
 * Datos del producto que la consola maneja (los escribe Inventarios).
 *  - `sku`: Inventarios lo exige y es único. Al crear, si la consola no lo da, el adaptador lo deriva del id del
 *    producto de forma determinista (el id si cabe en 40 caracteres; si no, 31 caracteres del id + «-» + 8 del SHA-256).
 *    Una vez creado NO se edita: la consola no lo ofrece y el adaptador lo rechaza.
 *  - `conSerie`: solo al crear (no cambia tras el primer movimiento de stock).
 *  - `garantiaMeses`: entero de 1 a 120 (igual que Inventarios).
 */
export interface DatosProducto {
  readonly nombre: string;
  readonly categoria: string;
  readonly marca?: string;
  readonly sku?: string;
  readonly activo: boolean;
  readonly garantiaMeses?: number;
  readonly conSerie?: boolean;
  /** Existencia total en o por debajo de la cual el producto figura «bajo mínimo». */
  readonly minimo?: number;
  readonly publicado?: boolean;
}

export interface ProductoCatalogo extends DatosProducto {
  readonly id: string;
  readonly precioUSD: PrecioUSD;
  /** Ausente: el producto no controla stock. */
  readonly stockTotal?: number;
  /**
   * Disponibilidad pública, calculada por Inventarios con SU regla única (`esDisponible`: activo y existencia en la
   * tienda mayor que cero). La consola la usa tal cual y no la recalcula.
   */
  readonly disponible: boolean;
}

/**
 * Lo mínimo del producto que se relee DENTRO de una transacción (guardar ficha, publicar): existencia implícita (el método devuelve
 * `undefined` si no existe), `activo`, `marca`, `nombre`, `categoria` y `precioUSD` (dólares decimales, igual que `ProductoCatalogo`).
 */
export type ProductoEnTransaccion = Pick<ProductoCatalogo, 'id' | 'nombre' | 'categoria' | 'marca' | 'activo' | 'precioUSD' | 'garantiaMeses'>;

export interface Existencia {
  readonly ubicacionId: UbicacionId;
  readonly cantidad: number;
}

/**
 * Productos, precios y stock, SOLO LECTURA. Los implementa Inventarios con SUS funciones: la consola nunca crea ni
 * edita productos ni escribe esas colecciones (el alta y la edición son de Inventarios).
 */
export interface CatalogoPuerto {
  listarProductos(tenantId: string): Promise<readonly ProductoCatalogo[]>;
  leerProducto(tenantId: string, productoId: string): Promise<ProductoCatalogo | undefined>;
  existenciasPorAlmacen(tenantId: string, productoId: string): Promise<readonly Existencia[]>;
  /**
   * Si el producto existe en Inventarios, leído CON la transacción `tx` de quien llama (no abre otra): así la lectura
   * forma parte de la misma transacción serializable que escribe la ficha o la reserva y se revalida en cada reintento.
   * Es una lectura: debe llamarse antes de la primera escritura de `tx`.
   */
  existeProductoEnTransaccion(tx: TransaccionIdentidad, tenantId: string, productoId: string): Promise<boolean>;
  /**
   * Como `existeProductoEnTransaccion`, pero devuelve los datos mínimos del producto (o `undefined` si no existe), leídos con la
   * transacción `tx` de quien llama. Es una lectura: debe llamarse antes de la primera escritura de `tx`. No debe leer existencias.
   * `marca` ausente o vacía = el producto no tiene marca.
   */
  leerProductoEnTransaccion(tx: TransaccionIdentidad, tenantId: string, productoId: string): Promise<ProductoEnTransaccion | undefined>;
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
  /** Opcional: borra todo objeto bajo el prefijo (restos de invocaciones que murieron). Sin él, esos restos quedan para el ciclo de vida del bucket. */
  borrarPrefijo?(prefijo: string): Promise<void>;
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
  /**
   * Si el procesamiento de ese tipo está disponible ahora. Opcional: sin él se asume que sí. `reservarSubida` lo consulta
   * para video y rechaza (`no-disponible`) antes de subir nada.
   */
  disponible?(tipo: TipoMedio): Promise<boolean>;
  inspeccionar(ruta: string, tipo: TipoMedio): Promise<InfoMedio>;
  procesar(solicitud: SolicitudProcesado): Promise<readonly VersionProcesada[]>;
}

/** Consulta de subidas por estado (índice de Firestore). */
export interface ConsultaSubidas {
  listarPorEstado(
    tenantId: string,
    estado: 'reservada' | 'procesando' | 'borrando',
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
