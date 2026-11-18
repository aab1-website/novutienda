// Tipos del contrato del panel. Se re-declaran (no se importan de los módulos) para que el panel no dependa de su
// código: cada tipo copia la forma serializable que devuelve la función pública del módulo indicado. Los montos son
// centavos enteros, igual que en el POS. Las fechas viajan como milisegundos (`...Ms`) o texto ISO, como en el módulo.
import type { CopiaCotizacion, Rol } from '@novutienda/nucleo';

export type { CopiaCotizacion, Rol };

// ---------------------------------------------------------------------------------------------------------------------
// POS (docs/modulos/pos.md; paquetes/pos/src/tipos.ts)
// ---------------------------------------------------------------------------------------------------------------------

export type MedioPago = 'efectivo' | 'qr' | 'transferencia' | 'credito';
export const MEDIOS_PAGO: readonly MedioPago[] = ['efectivo', 'qr', 'transferencia', 'credito'];
export type UbicacionId = 'tienda' | 'deposito-1' | 'deposito-2';
export const UBICACIONES: readonly UbicacionId[] = ['tienda', 'deposito-1', 'deposito-2'];

export type MontosPorMoneda = Readonly<Partial<Record<string, number>>>;

export interface TotalesMoneda {
  readonly efectivo: number;
  readonly qr: number;
  readonly transferencia: number;
  readonly credito: number;
  readonly ingresos: number;
  readonly egresos: number;
}
export type TotalesTurno = Readonly<Partial<Record<string, TotalesMoneda>>>;
export type EstadoTurno = 'abierto' | 'cerrado' | 'cerrado_forzado';

export interface TurnoPos {
  readonly turnoId: string;
  readonly cajaId: string;
  readonly cajeroUid: string;
  readonly estado: EstadoTurno;
  readonly apertura: MontosPorMoneda;
  readonly totales: TotalesTurno;
  readonly abiertoEnMs: number;
  readonly cerradoEnMs?: number;
  readonly cerradoPor?: string;
  readonly motivoCierre?: string;
  readonly contado?: MontosPorMoneda;
  readonly esperado?: MontosPorMoneda;
  readonly diferencia?: MontosPorMoneda;
}

export interface LineaVenta {
  readonly productoId: string;
  readonly nombre: string;
  readonly cantidad: number;
  readonly precioUnitario: number;
  readonly almacenId: string;
  readonly series: readonly string[];
  readonly garantiaMeses?: number;
}

export interface PagoVentaPos {
  readonly medio: MedioPago;
  readonly moneda: string;
  readonly monto: number;
  readonly cambio?: number;
  readonly referencia?: string;
  readonly registradoPor?: string;
}

export interface VentaPos {
  readonly ventaId: string;
  readonly turnoId: string;
  readonly cajaId: string;
  readonly cajeroUid: string;
  readonly estado: 'confirmada' | 'anulada';
  readonly moneda: string;
  readonly mercado: string;
  readonly cotizacion: CopiaCotizacion<string> | null;
  readonly lineas: readonly LineaVenta[];
  readonly subtotal: number;
  readonly descuento?: { readonly monto: number; readonly motivo: string; readonly aprobadoPor?: string; readonly aprobacionId?: string };
  readonly total: number;
  readonly pagos: readonly PagoVentaPos[];
  readonly cliente?: { readonly nombre: string; readonly telefono?: string };
  readonly serie: string;
  readonly receiptNo: number;
  readonly creadoEnMs: number;
  readonly solicitudAnulacion?: { readonly por: string; readonly motivo: string; readonly enMs: number };
}

export interface LineaCarrito {
  readonly productoId: string;
  readonly cantidad: number;
  readonly almacenId?: string;
  readonly series?: readonly string[];
  readonly precioMostrado?: number;
}

export interface Carrito {
  readonly mercado: string;
  readonly moneda: CodigoMoneda;
  readonly lineas: readonly LineaCarrito[];
  readonly descuento?: { readonly monto: number; readonly motivo: string };
  readonly cliente?: { readonly nombre: string; readonly telefono?: string };
  readonly totalMostrado?: number;
}

/** Pago que envía el cliente (campos que `validarPagos` admite). */
export interface PagoEntrada {
  readonly medio: MedioPago;
  readonly moneda: string;
  readonly monto: number;
  readonly cambio?: number;
  readonly referencia?: string;
}

export interface ResultadoVenta {
  readonly venta: VentaPos;
  readonly repetida: boolean;
}

export type TipoAprobacion = 'descuento' | 'credito';
export type EstadoAprobacion = 'pendiente' | 'aprobada' | 'rechazada' | 'usada';

export interface AprobacionPos {
  readonly aprobacionId: string;
  readonly tipo: TipoAprobacion;
  readonly estado: EstadoAprobacion;
  readonly moneda: string;
  readonly monto: number;
  readonly motivo: string;
  readonly deudor?: string;
  readonly solicitadoPor: string;
  readonly solicitadoEnMs: number;
  readonly aprobadoPor?: string;
  readonly aprobadoRol?: string;
  readonly motivoRechazo?: string | undefined;
}

export interface SolicitudAprobacion {
  readonly tipo: TipoAprobacion;
  readonly moneda: CodigoMoneda;
  readonly monto: number;
  readonly motivo: string;
  readonly deudor?: string;
}

export interface ReembolsoAnulacion {
  readonly medio: Exclude<MedioPago, 'credito'>;
  readonly moneda: string;
  readonly monto: number;
}

export interface ResultadoAnulacion {
  readonly ventaId: string;
  readonly reembolsos: readonly ReembolsoAnulacion[];
  readonly turnoIdReembolso: string;
}

export interface MovimientoCajaEntrada {
  readonly tipo: 'ingreso' | 'egreso';
  readonly moneda: string;
  readonly monto: number;
  readonly motivo: string;
  readonly comprobante?: string;
}

export interface MovimientoCaja extends MovimientoCajaEntrada {
  readonly requestId: string;
  readonly turnoId: string;
  readonly registradoPor: string;
  readonly creadoEnMs: number;
}

export interface CobroCreditoEntrada {
  readonly medio: Exclude<MedioPago, 'credito'>;
  readonly monto: number;
  readonly referencia?: string;
}

export interface CobroCredito extends CobroCreditoEntrada {
  readonly requestId: string;
  readonly ventaId: string;
  readonly turnoId: string;
  readonly moneda: string;
  readonly registradoPor: string;
  readonly creadoEnMs: number;
}

export interface CreditoVista {
  readonly ventaId: string;
  readonly deudor: string;
  readonly moneda: string;
  readonly monto: number;
  readonly saldo: number;
  readonly cobrado: number;
  readonly estado: 'pendiente' | 'cobrado' | 'anulado';
  readonly aprobadoPor: string;
  readonly turnoId: string;
  readonly creadoEnMs: number;
}

export interface ConfigPos {
  readonly negocio: { readonly nombre: string; readonly direccion?: string; readonly telefono?: string; readonly nit?: string };
  readonly logoUrl?: string;
  readonly colores: { readonly primario: string; readonly secundario: string };
  readonly mediosHabilitados: readonly MedioPago[];
  readonly monedaPorDefecto: string;
  /** Puntos básicos: 500 = 5 %. */
  readonly topesDescuentoBp: Readonly<Record<Rol, number>>;
  readonly textoRecibo: string;
  readonly serieRecibo: string;
}

export interface ArqueoMoneda {
  readonly esperado: number;
  readonly contado: number;
  readonly diferencia: number;
}

export interface ResultadoCierre {
  readonly turno: TurnoPos;
  readonly arqueo: Readonly<Partial<Record<string, ArqueoMoneda>>>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Inventarios (docs/modulos/inventarios.md)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Conteo abierto que oculta existencias a `caj` y `sup` (paquetes/inventarios/src/visibilidad.ts). `ubicacionId` es el almacén
 * en conteo; `abiertoEn` es ISO 8601 o `null` si el conteo no trae fecha.
 */
export interface ConteoAbierto {
  readonly ubicacionId: string;
  readonly conteoId: string;
  readonly abiertoEn: string | null;
}

/** Marca que el servidor agrega a toda respuesta con existencias ocultas (solo `caj`/`sup` con un conteo abierto). */
export interface MarcaOcultamiento {
  readonly existenciasOcultas: true;
  readonly conteosAbiertos: readonly ConteoAbierto[];
}

/** La marca, ausente cuando no se oculta nada. */
export type ConMarca<T> = T & Partial<MarcaOcultamiento>;

/**
 * Lista que puede llevar la marca de ocultamiento como propiedades de la propia lista (`lista.existenciasOcultas`,
 * `lista.conteosAbiertos`). Se lee directo; `filter`/`map`/spread producen listas sin marca.
 */
export type ListaConMarca<T> = ConMarca<readonly T[]>;

/**
 * Producto tal como lo devuelve la lectura del panel (ProductoLeido + existencias por almacén). Montos en centavos de USD.
 * Con un conteo abierto, a `caj`/`sup` lo oculto llega `null` (nunca 0): mostrar `ExistenciaOculta`, no un número.
 */
export interface ProductoPanel {
  readonly id: string;
  readonly nombre: string;
  readonly categoria: string;
  readonly marca?: string;
  readonly sku: string;
  readonly activo: boolean;
  readonly publicado: boolean;
  readonly conSerie: boolean;
  readonly garantiaMeses?: number;
  readonly minimo?: number;
  readonly precioUSD: PreciosPorMercado;
  /** Ids de los mercados declarados en los que el producto no tiene precio (los entrega el servidor). */
  readonly sinPrecio?: readonly string[];
  /** Solo se entrega al administrador. Centavos de USD. */
  readonly costoUSD?: number;
  /** Ausente: el producto no controla stock. `null`: oculto por un conteo abierto. */
  readonly stockTotal?: number | null;
  /** `null` en cada almacén en conteo (oculto), nunca 0. */
  readonly existencias: Readonly<Record<UbicacionId, number | null>>;
  /** `null`: oculto por un conteo abierto. */
  readonly bajoMinimo: boolean | null;
  /** Regla única `esDisponible` calculada por el servidor. `null`: oculto (la tienda está en conteo). */
  readonly disponible: boolean | null;
}

export interface EntradaProducto {
  readonly id: string;
  readonly nombre: string;
  readonly categoria: string;
  readonly marca?: string;
  readonly sku: string;
  readonly activo?: boolean;
  readonly publicado?: boolean;
  readonly conSerie?: boolean;
  readonly garantiaMeses?: number;
  readonly minimo?: number;
  readonly precioUSD: PreciosPorMercado;
  readonly costoUSD?: number;
  readonly controlaStock?: boolean;
}

export interface CambiosProducto {
  readonly nombre?: string;
  readonly categoria?: string;
  readonly marca?: string | null;
  readonly activo?: boolean;
  readonly publicado?: boolean;
  readonly conSerie?: boolean;
  readonly garantiaMeses?: number | null;
  readonly minimo?: number | null;
  readonly precioUSD?: PreciosPorMercado;
  readonly costoUSD?: number | null;
}

export interface LineaIngreso {
  readonly productoId: string;
  readonly cantidad: number;
  readonly series?: readonly string[];
}
export type LineaTraspaso = LineaIngreso;
export interface LineaAjuste {
  readonly productoId: string;
  readonly ubicacionId: UbicacionId;
  readonly delta: number;
}

export interface ResultadoOperacion {
  readonly resultado: Readonly<Record<string, unknown>>;
  readonly repetida: boolean;
}

export type EstadoSerie = 'disponible' | 'vendida' | 'merma';
export interface UnidadSerie {
  readonly productoId: string;
  readonly serie: string;
  readonly estado: EstadoSerie;
  readonly ubicacionId: UbicacionId;
  readonly ventaRef?: string;
  /** aaaa-mm-dd (calendario de La Paz). */
  readonly garantiaHasta?: string;
}

export type TipoMovimiento = 'ingreso' | 'traspaso' | 'ajuste' | 'venta' | 'anulacion' | 'merma' | 'conteo' | 'pedido';
export interface MovimientoVista {
  readonly id: string;
  readonly operacionId: string;
  readonly productoId: string;
  readonly ubicacionId: UbicacionId;
  readonly tipo: TipoMovimiento;
  readonly delta: number;
  /** Ausente si la ubicación del movimiento está en conteo y quien lee no es `adm`. */
  readonly saldoUbicacion?: number;
  readonly series: readonly string[];
  readonly referencia?: string;
  readonly por: string;
  readonly rol: Rol;
  readonly fecha: string;
  readonly motivo?: string;
}

export type EstadoMerma = 'solicitada' | 'aprobada' | 'rechazada';
export interface MermaVista {
  readonly mermaId: string;
  readonly productoId: string;
  readonly ubicacionId: UbicacionId;
  readonly cantidad: number;
  readonly series: readonly string[];
  readonly motivo: string;
  readonly estado: EstadoMerma;
  readonly solicitadaPor: string;
  readonly resueltaPor?: string;
  readonly motivoResolucion?: string;
  readonly fecha: string;
}

/** Un producto de la lista a contar: nada que dependa de las existencias del sistema (el conteo es ciego). */
export interface ProductoDeConteo {
  readonly productoId: string;
  readonly nombre: string;
  readonly sku: string;
  readonly categoria: string;
  readonly marca?: string;
  readonly conSerie: boolean;
}

export interface ConteoVista {
  readonly conteoId: string;
  readonly ubicacionId: UbicacionId;
  readonly estado: 'abierto' | 'cerrado' | 'cancelado';
  readonly abiertoPor: string;
  readonly cerradoPor?: string;
  /** Solo en un conteo cancelado. */
  readonly canceladoPor?: string;
  readonly motivoCancelacion?: string;
  readonly fecha: string;
  /** Lo que hay que contar, sin existencias ni nada derivado de ellas. Solo con el conteo abierto, para todo rol. */
  readonly productos?: readonly ProductoDeConteo[];
  /** Productos ya contados (el teórico NO viaja mientras el conteo está abierto). */
  readonly lineas: readonly { readonly productoId: string; readonly contado: number; readonly series?: readonly string[] }[];
  /** Solo en un conteo cerrado y solo para sup/adm. */
  readonly resultado?: readonly { readonly productoId: string; readonly teorico: number; readonly contado: number; readonly diferencia: number }[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Recibos (docs/modulos/recibos.md)
// ---------------------------------------------------------------------------------------------------------------------

export interface PlantillaRecibo {
  readonly logoUrl?: string;
  readonly negocio: { readonly nombre: string; readonly direccion?: string; readonly telefono?: string; readonly nit?: string };
  readonly pie?: string;
  readonly politicaGarantia?: string;
  readonly politicaCambios?: string;
}

export type EstadoEnvio = 'no_enviado' | 'sin_telefono' | 'enlace_generado' | 'enviado' | 'fallido';

export interface LineaRecibo {
  readonly productoId: string;
  readonly nombre: string;
  readonly cantidad: number;
  readonly precioUnitario: number;
  readonly subtotal: number;
  readonly series: readonly string[];
  readonly garantiaMeses?: number;
  readonly garantiaHasta?: string;
}

export interface Recibo {
  readonly reciboId: string;
  readonly tenantId: string;
  readonly ventaId: string;
  readonly numero: string;
  readonly estado: 'EMITIDO' | 'ANULADO';
  readonly fecha: string;
  readonly emitidoEn: string;
  readonly moneda: string;
  readonly total: number;
  readonly descuento?: { readonly monto: number; readonly motivo: string };
  readonly cotizacion: CopiaCotizacion<string> | null;
  readonly lineas: readonly LineaRecibo[];
  readonly pagos: readonly { readonly medio: string; readonly moneda: string; readonly monto: number }[];
  readonly facturaSuma?: string;
  readonly cliente?: { readonly nombre: string; readonly telefono?: string };
  readonly plantilla: PlantillaRecibo;
  readonly envioWhatsapp: { readonly estado: EstadoEnvio; readonly actualizadoEn?: string };
  readonly anulacion?: { readonly motivo: string; readonly anuladaPor: string; readonly aprobadoPor: string; readonly anuladoEn: string };
}

export interface ConsultaArchivo {
  readonly numero?: string;
  readonly desde?: string;
  readonly hasta?: string;
  readonly cliente?: string;
  readonly limite?: number;
}

export interface ResultadoEnvio {
  readonly estado: 'enlace_generado' | 'enviado' | 'fallido' | 'sin_telefono';
  /** Enlace wa.me que debe abrir la persona. */
  readonly enlace?: string;
}

// ---------------------------------------------------------------------------------------------------------------------
// Consola de catálogo y sitio (docs/modulos/website.md; paquetes/consola)
// ---------------------------------------------------------------------------------------------------------------------

export const PLANTILLAS_SITIO = ['cielo', 'bosque', 'ambar', 'grafito', 'ciruela'] as const;
export type PlantillaSitio = (typeof PLANTILLAS_SITIO)[number];

export const LIMITES_PANEL = {
  productos: 200,
  usuarios: 3,
  fotosPorProducto: 5,
  videosPorProducto: 1,
  bytesFoto: 15 * 1024 * 1024,
  bytesVideo: 200 * 1024 * 1024,
  duracionVideoSeg: 60,
  seccionesMax: 5,
  cuotaOriginalesBytes: 10 * 1024 * 1024 * 1024,
} as const;

export interface MedioFicha {
  readonly medioId: string;
  readonly alt: string;
}
export type EstadoFicha = 'borrador' | 'publicado' | 'oculto';
export interface FichaWeb {
  readonly slug: string;
  readonly descripcion: string;
  readonly garantia: string;
  readonly medios: readonly MedioFicha[];
  readonly seo: { readonly titulo: string; readonly descripcion: string };
  readonly estado: EstadoFicha;
}

export type Bloque =
  | { readonly tipo: 'texto'; readonly titulo: string; readonly parrafos: readonly string[] }
  | { readonly tipo: 'imagen'; readonly medioId: string; readonly alt: string }
  | { readonly tipo: 'carrusel'; readonly items: readonly { readonly medioId: string; readonly alt: string }[] }
  | { readonly tipo: 'enlaces'; readonly items: readonly { readonly texto: string; readonly url: string }[] };

export interface Seccion {
  readonly id: string;
  readonly titulo: string;
  readonly visible: boolean;
  readonly bloques: readonly Bloque[];
}

export interface ConfigSitio {
  readonly plantillaActiva: PlantillaSitio;
  readonly whatsappNovuchat: string;
  readonly medicion: { readonly ga4?: string; readonly searchConsole?: string; readonly metaPixel?: string; readonly tiktokPixel?: string };
}

export interface Carrusel {
  readonly plantilla: PlantillaSitio;
  readonly items: readonly { readonly medioId: string; readonly alt: string; readonly enlace?: string }[];
}

export type TipoMedio = 'foto' | 'video';
/** Versión procesada de un medio, tal como la entrega el servidor. `ruta` es la ruta pública (con hash de contenido) en el almacén de medios. */
export interface VersionMedio {
  readonly clase: 'imagen' | 'video' | 'poster';
  readonly lado: number;
  readonly formato: 'avif' | 'webp' | 'mp4';
  readonly ruta: string;
  readonly bytes: number;
}
export interface Medio {
  readonly id: string;
  readonly productoId: string;
  readonly tipo: TipoMedio;
  readonly bytesOriginal: number;
  readonly ancho: number;
  readonly alto: number;
  readonly duracionSeg?: number;
  readonly versiones?: readonly VersionMedio[];
  readonly creadoEn: number;
  readonly por: string;
}

/** Tipo de una subida: foto o video de un producto, o el logo del negocio. */
export type TipoSubida = TipoMedio | 'logo';
/** `productoId` con el que el servidor guarda la subida de un logo (el logo no pertenece a ningún producto). */
export const ID_NEGOCIO = '_negocio';
/** Tope del archivo de logo, igual que el servidor (JPG, PNG o WebP). */
export const BYTES_LOGO = 2 * 1024 * 1024;
/** Versión publicada del logo (PNG y WebP, lado mayor de 512 como máximo); `ruta` es relativa a la base de medios. */
export interface VersionLogo {
  readonly clase: 'logo';
  readonly formato: 'png' | 'webp';
  readonly lado: number;
  readonly ruta: string;
  readonly bytes: number;
}
/** Medio de una subida de logo (aparte de `Medio` para que ninguna ficha ni sección lo tome por una foto de producto). */
export interface MedioLogo {
  readonly id: string;
  readonly productoId: typeof ID_NEGOCIO;
  readonly tipo: 'logo';
  readonly bytesOriginal: number;
  readonly ancho: number;
  readonly alto: number;
  readonly versiones: readonly VersionLogo[];
  readonly creadoEn: number;
  readonly por: string;
}
/** Respuesta de `estadoSubidaLogo`: `medio` solo con `procesada`; `motivo` si se rechazó. */
export interface ResultadoEstadoSubidaLogo {
  readonly estado: EstadoSubida;
  readonly medio?: MedioLogo;
  readonly motivo?: string;
}
/** Logo vigente del negocio (`leerLogo`); guarda rutas relativas, no URL. */
export interface LogoNegocio {
  readonly medioId: string;
  readonly ancho: number;
  readonly alto: number;
  readonly versiones: readonly { readonly formato: 'png' | 'webp'; readonly lado: number; readonly ruta: string; readonly bytes: number }[];
  readonly actualizadoEn: string;
}

export interface Reserva {
  readonly subidaId: string;
  /** Ruta privada a la que el cliente sube (subida reanudable). */
  readonly rutaOriginal: string;
  readonly venceEn: number;
}

export type EstadoSubida = 'reservada' | 'procesada' | 'borrando' | 'rechazada';
/** Respuesta de `estadoSubida`: `medio` solo con `procesada`; `motivo` si la subida se rechazó. */
export interface ResultadoEstadoSubida {
  readonly estado: EstadoSubida;
  readonly medio?: Medio;
  readonly motivo?: string;
}
export interface SubidaVista {
  readonly subidaId: string;
  readonly productoId: string;
  readonly tipo: TipoMedio;
  readonly estado: EstadoSubida;
  readonly motivo?: string;
}

export type CotizacionTablero =
  | { readonly mercado: string; readonly estado: 'vigente' | 'ultimo_verificado'; readonly par: string; readonly valor: number; readonly fecha: string; readonly fuente: string }
  | { readonly mercado: string; readonly estado: 'sin_cotizacion'; readonly motivo: string };

export interface Tablero {
  readonly cambiosSinPublicar: number;
  readonly ultimoCambioEn: string;
  readonly publicadoEn: string | null;
  readonly versionPublicada: number;
  /** Si un retiro automático dejó el sitio sin productos o sin fotos (`en`: instante ISO del retiro); `null` si no hay aviso. */
  readonly avisoSitio: { readonly motivo: 'sin_productos' | 'sin_fotos'; readonly en: string } | null;
  readonly cotizaciones: readonly CotizacionTablero[];
  readonly uso: {
    readonly productos: { readonly usados: number; readonly tope: number };
    readonly usuarios: { readonly usados: number; readonly tope: number };
    readonly originalesBytes: { readonly usados: number; readonly tope: number };
  };
}

export interface ResultadoPublicacion {
  readonly version: number;
  readonly productos: number;
  readonly decision: { readonly accion: string; readonly para?: number };
  readonly advertencias: readonly string[];
}

/** Error de una fila de importación: `columna` es el encabezado tal como viene en el archivo, o `null` si es de la fila entera. */
export interface ErrorFilaImportacion {
  readonly columna: string | null;
  readonly motivo: string;
  /** En «sku repetido»: línea del archivo donde el SKU apareció primero. */
  readonly filaPrevia?: number;
}

export interface FilaSimulada {
  /** Número de línea del archivo (el encabezado es la 1). */
  readonly linea: number;
  readonly id: string;
  readonly nombre?: string | undefined;
  readonly sku?: string | undefined;
  readonly accion: 'crear' | 'actualizar' | 'sin-cambios' | 'error';
  readonly errores: readonly ErrorFilaImportacion[];
  readonly advertencias: readonly string[];
  /** Campos que cambiarían (nombres canónicos de columna); vacío salvo en `actualizar`. */
  readonly cambios: readonly string[];
}

export interface Simulacion {
  readonly filas: readonly FilaSimulada[];
  readonly resumen: { readonly crear: number; readonly actualizar: number; readonly sinCambios: number; readonly errores: number };
  readonly columnasIgnoradas: readonly string[];
}

/**
 * Origen de una importación de productos: `archivo` es el .csv o .xlsx en base64 (hasta 2 MB; el servidor distingue por la
 * firma, no por la extensión) o `csv` es el texto. Uno solo.
 */
export type FuenteImportacion =
  | { readonly archivo: string; readonly csv?: undefined }
  | { readonly csv: string; readonly archivo?: undefined };

/** Resultado de una importación aplicada por tandas (no es «todo o nada» entre tandas). */
export interface ResultadoImportacion {
  /** `false` si se detuvo a mitad: lo ya aplicado queda; se reintenta con el mismo `operacionId`. */
  readonly completa: boolean;
  readonly creados: number;
  readonly actualizados: number;
  readonly sinCambios: number;
  /** Filas con error que se omitieron (`omitirErrores`). */
  readonly omitidas: number;
  readonly lotes: { readonly total: number; readonly aplicados: number };
  readonly productos: readonly string[];
  /** Motivo de la detención, si `completa` es `false`. */
  readonly detencion?: string;
  /** `true`: las filas con error ya no son las que se aceptaron omitir; no se escribió nada y `simulacion` es la nueva. */
  readonly desactualizada?: boolean;
  readonly simulacion: Simulacion;
}

// ---------------------------------------------------------------------------------------------------------------------
// Identidad, auditoría y cotizaciones (núcleo)
// ---------------------------------------------------------------------------------------------------------------------

/** Mercados y monedas del comercio de la sesión, tal como los entrega el servidor (nunca las fuentes del tipo de cambio). */
export interface VistaComercial {
  readonly mercados: readonly {
    readonly id: string;
    readonly nombre: string;
    readonly monedaVenta: string;
    readonly monedaBase: string;
    readonly tieneTipoCambio: boolean;
  }[];
  readonly monedasCaja: readonly string[];
  /** Código de la moneda en que se declara el costo (nunca montos). Ausente si el servidor no lo entregó: no se supone ninguna. */
  readonly monedaCosto?: string;
}

/** Mercado declarado por el comercio, tal como lo entrega `configuracionComercial`. */
export type MercadoDeclarado = VistaComercial['mercados'][number];
/** Código ISO 4217 de una moneda declarada por el comercio (abierto: ya no se limita a BOB, USD y ARS). */
export type CodigoMoneda = string;
/** Identificador de un mercado declarado (dos letras mayúsculas). */
export type IdMercado = string;
/** Precios base por mercado, en centavos de la moneda base del mercado, con el id del mercado en minúsculas como clave. */
export type PreciosPorMercado = Readonly<Record<string, number>>;

export interface UsuarioVista {
  readonly uid: string;
  /** `null` si la cuenta no tiene correo. */
  readonly correo: string | null;
  /** Rol vigente; en una invitación pendiente, el rol reservado. */
  readonly rol: Rol;
  readonly verificado: boolean;
  /** `invitado`: invitación pendiente (ocupa un cupo y aún no tiene acceso). Ausente o `activo`: miembro. */
  readonly estado?: 'activo' | 'invitado';
  /** Solo en una invitación: instante (ms) en que caduca. */
  readonly venceEnMs?: number;
}

export interface EntradaAuditoriaVista {
  readonly id: string;
  readonly fecha: string;
  readonly uid: string;
  readonly rol: Rol;
  readonly accion: string;
  readonly ruta: string;
  readonly motivo?: string;
}

export interface CotizacionVista {
  readonly cotizacionId: string;
  readonly par: string;
  readonly valor: number;
  readonly fecha: string;
  readonly fuente: string;
  readonly estado: 'vigente' | 'ultimo_verificado';
}
export type CotizacionesVigentes = Readonly<Record<string, CotizacionVista | null>>;
