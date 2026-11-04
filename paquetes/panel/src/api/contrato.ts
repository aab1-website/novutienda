// OPERACIONES DEL PANEL. Es el vocabulario con el que las pantallas piden cosas (montos en centavos, fechas aaaa-mm-dd,
// listas planas). El contrato REAL con el servidor es otro y vive en `real.ts`: una Cloud Function por módulo
// (`pos`, `inventarios`, `consola`, `recibos`, `medios`) que recibe `{ accion, tenantId, datos }` (docs/produccion/funciones.md §2-§3).
// `real.ts` traduce cada operación del panel a una o varias acciones reales; el cliente real y el doble en memoria pasan
// por esa misma traducción, de modo que las pruebas del panel ejercitan la forma real de la llamada.
import type {
  AprobacionPos, Carrito, Carrusel, CambiosProducto, CobroCredito, CobroCreditoEntrada, ConfigPos, ConfigSitio,
  ConsultaArchivo, PrecioUSDCentavos, ConteoVista, CotizacionesVigentes, CreditoVista, EntradaAuditoriaVista, EntradaProducto, FichaWeb,
  LineaAjuste, LineaIngreso, LineaTraspaso, Medio, MermaVista, MontosPorMoneda, MovimientoCaja, MovimientoCajaEntrada, MovimientoVista,
  PagoEntrada, PlantillaRecibo, ProductoPanel, Recibo, Reserva, ResultadoAnulacion, ResultadoCierre, ResultadoEnvio,
  ResultadoImportacion, ResultadoOperacion, ResultadoPublicacion, ResultadoVenta, Rol, Seccion, Simulacion, SolicitudAprobacion,
  Tablero, TipoMedio, TurnoPos, UbicacionId, UnidadSerie, UsuarioVista, VentaPos, EstadoMerma,
  TipoMovimiento,
} from './tipos.js';

type Vacio = Record<string, never>;
type Ok = { readonly ok: true };

export interface Contrato {
  // ---- POS ----
  abrirTurno: { entrada: { turnoId: string; apertura: MontosPorMoneda }; salida: TurnoPos };
  cerrarTurno: { entrada: { turnoId: string; contado: MontosPorMoneda }; salida: ResultadoCierre };
  cerrarTurnoForzado: { entrada: { turnoId: string; contado: MontosPorMoneda; motivo: string }; salida: ResultadoCierre };
  confirmarVenta: {
    entrada: { requestId: string; carrito: Carrito; pagos: readonly PagoEntrada[]; aprobacionId?: string; aprobacionCreditoId?: string };
    salida: ResultadoVenta;
  };
  solicitarAprobacion: { entrada: { aprobacionId: string; solicitud: SolicitudAprobacion }; salida: AprobacionPos };
  resolverAprobacion: { entrada: { aprobacionId: string; decision: 'aprobar' | 'rechazar' }; salida: AprobacionPos };
  solicitarAnulacion: { entrada: { ventaId: string; motivo: string }; salida: VentaPos };
  aprobarAnulacion: { entrada: { ventaId: string; motivo: string }; salida: ResultadoAnulacion };
  registrarMovimientoCaja: { entrada: { requestId: string; movimiento: MovimientoCajaEntrada }; salida: { movimiento: MovimientoCaja; repetido: boolean } };
  cobrarCredito: { entrada: { requestId: string; ventaId: string; cobro: CobroCreditoEntrada }; salida: { cobro: CobroCredito; repetido: boolean } };
  guardarConfigPos: { entrada: { config: ConfigPos }; salida: ConfigPos };
  // ---- Inventarios (cada una lleva `operacionId`, idempotente) ----
  /** Alta: `consola.crearProducto` (precios en USD decimales en el servidor) y, si trae costo, `inventarios.fijarCosto`. Solo adm. */
  crearProducto: { entrada: { operacionId: string; producto: EntradaProducto }; salida: ResultadoOperacion };
  actualizarProducto: { entrada: { operacionId: string; productoId: string; cambios: CambiosProducto }; salida: ResultadoOperacion };
  ingresar: { entrada: { operacionId: string; ubicacionId: UbicacionId; lineas: readonly LineaIngreso[] }; salida: ResultadoOperacion };
  traspasar: { entrada: { operacionId: string; origenId: UbicacionId; destinoId: UbicacionId; lineas: readonly LineaTraspaso[] }; salida: ResultadoOperacion };
  ajustar: { entrada: { operacionId: string; motivo: string; lineas: readonly LineaAjuste[] }; salida: ResultadoOperacion };
  solicitarMerma: {
    entrada: { operacionId: string; productoId: string; ubicacionId: UbicacionId; cantidad: number; series?: readonly string[]; motivo: string };
    salida: ResultadoOperacion;
  };
  resolverMerma: { entrada: { operacionId: string; mermaId: string; decision: 'aprobada' | 'rechazada'; motivo?: string }; salida: ResultadoOperacion };
  abrirConteo: { entrada: { operacionId: string; conteoId: string; ubicacionId: UbicacionId }; salida: ResultadoOperacion };
  registrarLineaConteo: {
    entrada: { operacionId: string; conteoId: string; productoId: string; contado?: number; series?: readonly string[] };
    salida: ResultadoOperacion;
  };
  cerrarConteo: { entrada: { operacionId: string; conteoId: string }; salida: ResultadoOperacion };
  importarProductosCsv: { entrada: { operacionId: string; csv: string; cargaInicial?: boolean }; salida: ResultadoOperacion };
  /** Función pura del módulo expuesta como callable: devuelve el CSV (celdas neutralizadas) de los productos del tenant. */
  exportarProductosCsv: { entrada: Vacio; salida: { csv: string } };
  // ---- Recibos ----
  buscarComprobantes: { entrada: { consulta: ConsultaArchivo }; salida: readonly Recibo[] };
  /** El servidor genera el PDF, lo guarda en una ruta privada y devuelve el enlace `wa.me` (que la persona abre y envía). */
  enviarRecibo: { entrada: { reciboId: string; codigoPais?: string }; salida: ResultadoEnvio };
  referenciarFacturaSuma: { entrada: { reciboId: string; facturaSuma: string }; salida: Ok };
  guardarPlantilla: { entrada: { plantilla: PlantillaRecibo }; salida: Ok };
  // ---- Consola (catálogo y sitio) ----
  obtenerTablero: { entrada: Vacio; salida: Tablero };
  publicarSitio: { entrada: Vacio; salida: ResultadoPublicacion };
  /** Centavos de USD, como en todo el panel; `real.ts` convierte a dólares decimales porque `consola.cambiarPrecioUSD` los espera así. */
  cambiarPrecioUSD: { entrada: { productoId: string; precioUSD: PrecioUSDCentavos }; salida: Ok };
  guardarFicha: { entrada: { productoId: string; ficha: FichaWeb }; salida: Ok };
  reservarSubida: { entrada: { subidaId: string; productoId: string; tipo: TipoMedio; bytes: number }; salida: Reserva };
  finalizarSubida: { entrada: { subidaId: string }; salida: Medio };
  borrarMedio: { entrada: { medioId: string }; salida: Ok };
  guardarSeccion: { entrada: { seccion: Seccion }; salida: Ok };
  eliminarSeccion: { entrada: { seccionId: string }; salida: Ok };
  ordenarSecciones: { entrada: { orden: readonly string[] }; salida: Ok };
  guardarCarrusel: { entrada: { carrusel: Carrusel }; salida: Ok };
  guardarConfigSitio: { entrada: { config: ConfigSitio }; salida: Ok };
  simularImportacion: { entrada: { contenidoBase64: string }; salida: Simulacion };
  importarProductos: { entrada: { contenidoBase64: string; omitirErrores?: boolean }; salida: ResultadoImportacion };
  /** Se renombra (en la consola es `exportarProductosCsv`) para no chocar con la de Inventarios. */
  exportarProductosCsvSitio: { entrada: Vacio; salida: { csv: string } };
  // ---- Identidad (núcleo) ----
  asignarRol: { entrada: { uid: string; rol: Rol }; salida: Ok };
  quitarRol: { entrada: { uid: string }; salida: Ok };
  /**
   * Busca una cuenta existente por correo para asignarle rol (solo `adm`). Por privacidad responde solo si la cuenta ya es
   * miembro de este negocio o no pertenece a ninguno; en cualquier otro caso responde «no encontrado», igual que si no existiera.
   */
  buscarUsuarioPorCorreo: { entrada: { correo: string }; salida: { uid: string; correoVerificado: boolean; conContrasena: boolean } };
  // ---- Lecturas del panel (sin función pública equivalente) ----
  leerConfigPos: { entrada: Vacio; salida: ConfigPos };
  leerPlantilla: { entrada: Vacio; salida: PlantillaRecibo };
  cotizacionesVigentes: { entrada: Vacio; salida: CotizacionesVigentes };
  listarProductos: { entrada: Vacio; salida: readonly ProductoPanel[] };
  listarSeries: { entrada: { productoId: string; ubicacionId?: UbicacionId; soloDisponibles?: boolean }; salida: readonly UnidadSerie[] };
  buscarSerie: { entrada: { serie: string }; salida: readonly UnidadSerie[] };
  listarMovimientos: {
    entrada: { desde?: string; hasta?: string; productoId?: string; tipo?: TipoMovimiento; usuario?: string; limite?: number };
    salida: readonly MovimientoVista[];
  };
  listarMermas: { entrada: { estado?: EstadoMerma }; salida: readonly MermaVista[] };
  listarConteos: { entrada: Vacio; salida: readonly ConteoVista[] };
  /** Turno abierto del usuario (o `null`). */
  turnoActual: { entrada: Vacio; salida: TurnoPos | null };
  /** sup/adm: todos los turnos; caj: solo los propios. */
  listarTurnos: { entrada: { estado?: 'abierto' | 'cerrado' }; salida: readonly TurnoPos[] };
  /** caj: solo sus ventas; sup/adm: todas. */
  listarVentas: { entrada: { turnoId?: string; desde?: string; hasta?: string; conSolicitudAnulacion?: boolean }; salida: readonly VentaPos[] };
  listarAprobaciones: { entrada: { estado?: 'pendiente' | 'aprobada' | 'rechazada' | 'usada' }; salida: readonly AprobacionPos[] };
  listarMovimientosCaja: { entrada: { turnoId?: string }; salida: readonly MovimientoCaja[] };
  /** Ventas del rango (aaaa-mm-dd) en CSV, con celdas neutralizadas por el servidor (`sup`/`adm`). */
  exportarVentasCsv: { entrada: { desde?: string; hasta?: string }; salida: { csv: string } };
  listarCreditos: { entrada: { estado?: 'pendiente' | 'cobrado' | 'anulado' }; salida: readonly CreditoVista[] };
  listarAuditoria: { entrada: { desde?: string; hasta?: string; accion?: string; uid?: string; limite?: number }; salida: readonly EntradaAuditoriaVista[] };
  /** Recibo emitido para una venta (el módulo lo emite al consumir el evento: puede tardar), o `null`. */
  obtenerRecibo: { entrada: { ventaId: string }; salida: Recibo | null };
  listarFichas: { entrada: Vacio; salida: readonly { productoId: string; ficha: FichaWeb }[] };
  listarMedios: { entrada: { productoId: string }; salida: readonly Medio[] };
  leerConfigSitio: { entrada: Vacio; salida: ConfigSitio | null };
  listarSecciones: { entrada: Vacio; salida: readonly Seccion[] };
  listarCarruseles: { entrada: Vacio; salida: readonly Carrusel[] };
  listarUsuarios: { entrada: Vacio; salida: readonly UsuarioVista[] };
}

export type NombreCallable = keyof Contrato;
export type Entrada<N extends NombreCallable> = Contrato[N]['entrada'];
export type Salida<N extends NombreCallable> = Contrato[N]['salida'];

export { NOMBRES_CALLABLE, ROLES_CALLABLE } from './real.js';
