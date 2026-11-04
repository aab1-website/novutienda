// CONTRATO de callables que el panel asume. Una callable por función pública de cada módulo, con el mismo nombre y la
// misma entrada SIN `tx`, `deps`, `actor` ni `por` (esos salen del token en el servidor). El transporte agrega
// `tenantId` a toda entrada. Las "lecturas" no tienen función pública: son consultas que el panel necesita y que el
// servidor puede resolver como callables o como lecturas protegidas por reglas; el panel solo conoce este contrato.
import type {
  AprobacionPos, Carrito, Carrusel, CambiosProducto, CobroCredito, CobroCreditoEntrada, ConfigPos, ConfigSitio,
  ConsultaArchivo, ConteoVista, CotizacionesVigentes, CreditoVista, DatosProducto, EntradaAuditoriaVista, EntradaProducto, FichaWeb,
  LineaAjuste, LineaIngreso, LineaTraspaso, Medio, MermaVista, MontosPorMoneda, MovimientoCaja, MovimientoCajaEntrada, MovimientoVista,
  PagoEntrada, PlantillaRecibo, ProductoPanel, Recibo, Reserva, ResultadoAnulacion, ResultadoCierre, ResultadoEnvio,
  ResultadoImportacion, ResultadoOperacion, ResultadoPublicacion, ResultadoVenta, Rol, Seccion, Simulacion, SolicitudAprobacion,
  SubidaVista, Tablero, TipoMedio, TurnoPos, UbicacionId, UnidadSerie, UsuarioVista, VentaPos, EstadoMerma,
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
  aprobarAnulacion: { entrada: { ventaId: string }; salida: ResultadoAnulacion };
  registrarMovimientoCaja: { entrada: { requestId: string; movimiento: MovimientoCajaEntrada }; salida: { movimiento: MovimientoCaja; repetido: boolean } };
  cobrarCredito: { entrada: { requestId: string; ventaId: string; cobro: CobroCreditoEntrada }; salida: { cobro: CobroCredito; repetido: boolean } };
  guardarConfigPos: { entrada: { config: ConfigPos }; salida: ConfigPos };
  // ---- Inventarios (cada una lleva `operacionId`, idempotente) ----
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
  generarPdfRecibo: { entrada: { reciboId: string }; salida: { enlacePdf: string } };
  enviarRecibo: { entrada: { reciboId: string; enlacePdf: string }; salida: ResultadoEnvio };
  referenciarFacturaSuma: { entrada: { reciboId: string; facturaSuma: string }; salida: Ok };
  guardarPlantilla: { entrada: { plantilla: PlantillaRecibo }; salida: Ok };
  // ---- Consola (catálogo y sitio) ----
  obtenerTablero: { entrada: Vacio; salida: Tablero };
  publicarSitio: { entrada: Vacio; salida: ResultadoPublicacion };
  /** `precioUSD` en dólares decimales (la consola valida hasta 2 decimales); el resto del panel trabaja en centavos. */
  crearProductoConsola: { entrada: { productoId: string; datos: DatosProducto; precioUSD: { bo: number; ar: number } }; salida: Ok };
  editarProductoConsola: { entrada: { productoId: string; cambios: Partial<DatosProducto> }; salida: Ok };
  cambiarPrecioUSD: { entrada: { productoId: string; precioUSD: { bo: number; ar: number } }; salida: Ok };
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
  listarCreditos: { entrada: { estado?: 'pendiente' | 'cobrado' | 'cancelado' }; salida: readonly CreditoVista[] };
  listarAuditoria: { entrada: { desde?: string; hasta?: string; accion?: string; uid?: string; limite?: number }; salida: readonly EntradaAuditoriaVista[] };
  /** Recibo emitido para una venta (el módulo lo emite al consumir el evento: puede tardar), o `null`. */
  obtenerRecibo: { entrada: { ventaId: string }; salida: Recibo | null };
  listarFichas: { entrada: Vacio; salida: readonly { productoId: string; ficha: FichaWeb }[] };
  listarMedios: { entrada: { productoId: string }; salida: readonly Medio[] };
  estadoSubida: { entrada: { subidaId: string }; salida: SubidaVista };
  leerConfigSitio: { entrada: Vacio; salida: ConfigSitio | null };
  listarSecciones: { entrada: Vacio; salida: readonly Seccion[] };
  listarCarruseles: { entrada: Vacio; salida: readonly Carrusel[] };
  listarUsuarios: { entrada: Vacio; salida: readonly UsuarioVista[] };
}

export type NombreCallable = keyof Contrato;
export type Entrada<N extends NombreCallable> = Contrato[N]['entrada'];
export type Salida<N extends NombreCallable> = Contrato[N]['salida'];

const TODOS: readonly Rol[] = ['caj', 'sup', 'adm'];
const SUP: readonly Rol[] = ['sup', 'adm'];
const ADM: readonly Rol[] = ['adm'];

/** Quién puede llamar a cada callable (copia de los permisos de los módulos). El doble los aplica; el servidor es la autoridad. */
export const ROLES_CALLABLE: Readonly<Record<NombreCallable, readonly Rol[]>> = {
  abrirTurno: TODOS, cerrarTurno: TODOS, cerrarTurnoForzado: ADM, confirmarVenta: TODOS, solicitarAprobacion: TODOS,
  resolverAprobacion: SUP, solicitarAnulacion: TODOS, aprobarAnulacion: SUP, registrarMovimientoCaja: TODOS, cobrarCredito: TODOS,
  guardarConfigPos: ADM,
  crearProducto: ADM, actualizarProducto: ADM, ingresar: SUP, traspasar: SUP, ajustar: ADM, solicitarMerma: TODOS, resolverMerma: SUP,
  abrirConteo: SUP, registrarLineaConteo: TODOS, cerrarConteo: SUP, importarProductosCsv: ADM, exportarProductosCsv: SUP,
  buscarComprobantes: TODOS, generarPdfRecibo: TODOS, enviarRecibo: TODOS, referenciarFacturaSuma: SUP, guardarPlantilla: SUP,
  obtenerTablero: SUP, publicarSitio: ADM, crearProductoConsola: ADM, editarProductoConsola: ADM, cambiarPrecioUSD: ADM,
  guardarFicha: SUP, reservarSubida: SUP, finalizarSubida: SUP, borrarMedio: SUP, guardarSeccion: ADM, eliminarSeccion: ADM,
  ordenarSecciones: ADM, guardarCarrusel: ADM, guardarConfigSitio: ADM, simularImportacion: ADM, importarProductos: ADM,
  exportarProductosCsvSitio: SUP, asignarRol: ADM, quitarRol: ADM,
  leerConfigPos: TODOS, leerPlantilla: TODOS, cotizacionesVigentes: TODOS, listarProductos: TODOS, listarSeries: TODOS, buscarSerie: TODOS,
  listarMovimientos: SUP, listarMermas: TODOS, listarConteos: TODOS, turnoActual: TODOS, listarTurnos: TODOS, listarVentas: TODOS,
  listarAprobaciones: TODOS, listarMovimientosCaja: TODOS, listarCreditos: TODOS, listarAuditoria: SUP, obtenerRecibo: TODOS,
  listarFichas: SUP, listarMedios: SUP, estadoSubida: SUP, leerConfigSitio: SUP, listarSecciones: SUP, listarCarruseles: SUP,
  listarUsuarios: ADM,
};

export const NOMBRES_CALLABLE = Object.keys(ROLES_CALLABLE) as NombreCallable[];
