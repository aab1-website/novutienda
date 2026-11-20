// OPERACIONES DEL PANEL. Es el vocabulario con el que las pantallas piden cosas (montos en centavos, fechas aaaa-mm-dd,
// listas planas). El contrato REAL con el servidor es otro y vive en `real.ts`: una Cloud Function por módulo
// (`pos`, `inventarios`, `consola`, `recibos`, `medios`) que recibe `{ accion, tenantId, datos }` (docs/produccion/funciones.md §2-§3).
// `real.ts` traduce cada operación del panel a una o varias acciones reales; el cliente real y el doble en memoria pasan
// por esa misma traducción, de modo que las pruebas del panel ejercitan la forma real de la llamada.
import type {
  AprobacionPos, Carrito, CarritoGuardado, ContenidoCarritoGuardado, Carrusel, CambiosProducto, CobroCredito, CobroCreditoEntrada, ConfigPos, ConfigSitio,
  ConsultaArchivo, PreciosPorMercado, ConteoVista, CotizacionesVigentes, CreditoVista, EntradaAuditoriaVista, EntradaProducto, FichaWeb,
  LineaAjuste, LineaIngreso, LineaTraspaso, LogoNegocio, Medio, MedioLogo, ResultadoEstadoSubidaLogo, MermaVista, MontosPorMoneda, MovimientoCaja, MovimientoCajaEntrada, MovimientoVista,
  ConMarca, ListaConMarca, PagoEntrada, PlantillaRecibo, ProductoPanel, Recibo, Reserva, ResultadoAnulacion, ResultadoCierre, ResultadoEnvio,
  FuenteImportacion, ResultadoImportacion, ResultadoOperacion, ResultadoEstadoSubida, ResultadoPublicacion, ResultadoVenta, Rol, Seccion, Simulacion, SolicitudAprobacion,
  ResumenCarritoSupervision, CursorTurno, CursorVenta, FilaTurnoVista, ResumenTurnoVista, Tablero, TipoMedio, TurnoPos, UbicacionId, UnidadSerie, UsuarioVista, VentaPos, EstadoMerma,
  TipoMovimiento, VistaComercial,
} from './tipos.js';

type Vacio = Record<string, never>;
type Ok = { readonly ok: true };

export interface Contrato {
  // ---- POS ----
  abrirTurno: { entrada: { turnoId: string; apertura: MontosPorMoneda }; salida: TurnoPos };
  cerrarTurno: { entrada: { turnoId: string; contado: MontosPorMoneda }; salida: ResultadoCierre };
  cerrarTurnoForzado: { entrada: { turnoId: string; contado: MontosPorMoneda; motivo: string }; salida: ResultadoCierre };
  confirmarVenta: {
    entrada: { requestId: string; carrito: Carrito; pagos: readonly PagoEntrada[]; aprobacionId?: string; aprobacionCreditoId?: string; carritoId?: string; carritoVersion?: number };
    salida: ResultadoVenta;
  };
  /** Abre un carrito guardado en el turno propio (idempotente por `carritoId`; tope por turno en el servidor). */
  crearCarrito: { entrada: { carritoId: string; etiqueta?: string }; salida: CarritoGuardado };
  /** Guarda el contenido o la etiqueta; `version` es la que el panel conoce (distinta: `carrito-conflicto` con el carrito vigente en `detalle.carrito`). */
  guardarCarrito: { entrada: { carritoId: string; version: number; contenido?: ContenidoCarritoGuardado; etiqueta?: string }; salida: CarritoGuardado };
  /** El dueño, o `sup`/`adm` con motivo (auditado). */
  cancelarCarrito: { entrada: { carritoId: string; motivo: string }; salida: CarritoGuardado };
  misCarritos: { entrada: Vacio; salida: readonly CarritoGuardado[] };
  carritosSupervision: { entrada: Vacio; salida: readonly ResumenCarritoSupervision[] };
  solicitarAprobacion: { entrada: { aprobacionId: string; solicitud: SolicitudAprobacion }; salida: AprobacionPos };
  resolverAprobacion: { entrada: { aprobacionId: string; decision: 'aprobar' | 'rechazar'; motivo?: string | undefined }; salida: AprobacionPos };
  solicitarAnulacion: { entrada: { ventaId: string; motivo: string }; salida: VentaPos };
  aprobarAnulacion: { entrada: { ventaId: string; motivo: string }; salida: ResultadoAnulacion };
  registrarMovimientoCaja: { entrada: { requestId: string; movimiento: MovimientoCajaEntrada }; salida: { movimiento: MovimientoCaja; repetido: boolean } };
  cobrarCredito: { entrada: { requestId: string; ventaId: string; cobro: CobroCreditoEntrada }; salida: { cobro: CobroCredito; repetido: boolean } };
  guardarConfigPos: { entrada: { config: ConfigPos }; salida: ConfigPos };
  // ---- Inventarios (cada una lleva `operacionId`, idempotente) ----
  /** Alta: `inventarios.crearProducto` (centavos de USD, un precio por mercado, costo opcional). Solo adm. */
  crearProducto: { entrada: { operacionId: string; producto: EntradaProducto }; salida: ResultadoOperacion };
  /** Edición: `inventarios.editarProducto`; campo ausente = sin cambio, `null` vacía marca, garantía, mínimo o costo. */
  actualizarProducto: { entrada: { operacionId: string; productoId: string; cambios: CambiosProducto }; salida: ResultadoOperacion };
  ingresar: { entrada: { operacionId: string; ubicacionId: UbicacionId; lineas: readonly LineaIngreso[] }; salida: ResultadoOperacion };
  traspasar: { entrada: { operacionId: string; origenId: UbicacionId; destinoId: UbicacionId; lineas: readonly LineaTraspaso[] }; salida: ResultadoOperacion };
  ajustar: { entrada: { operacionId: string; motivo: string; lineas: readonly LineaAjuste[] }; salida: ResultadoOperacion };
  solicitarMerma: {
    entrada: { operacionId: string; productoId: string; ubicacionId: UbicacionId; cantidad: number; series?: readonly string[]; motivo: string };
    salida: ResultadoOperacion;
  };
  /** Rechazar exige `motivo` (el servidor responde 400 sin él). */
  resolverMerma: {
    entrada: { operacionId: string; mermaId: string } & ({ decision: 'aprobada'; motivo?: string } | { decision: 'rechazada'; motivo: string });
    salida: ResultadoOperacion;
  };
  abrirConteo: { entrada: { operacionId: string; conteoId: string; ubicacionId: UbicacionId }; salida: ResultadoOperacion };
  registrarLineaConteo: {
    entrada: { operacionId: string; conteoId: string; productoId: string; contado?: number; series?: readonly string[] };
    salida: ResultadoOperacion;
  };
  /** `sinContar` ausente = `'igual'`: lo no contado no cambia; `'cero'`: lo que tenga existencias se toma como 0 y genera mermas. */
  cerrarConteo: { entrada: { operacionId: string; conteoId: string; sinContar?: 'igual' | 'cero' }; salida: ResultadoOperacion };
  /** Solo adm; motivo obligatorio (1..500). No mueve stock ni crea mermas: libera el almacén. */
  cancelarConteo: { entrada: { operacionId: string; conteoId: string; motivo: string }; salida: ResultadoOperacion };
  /** Simulación fila por fila (`inventarios.importarProductosCsv` con `simular: true`): no escribe ni usa `operacionId`. Solo adm. */
  simularImportacionProductos: { entrada: FuenteImportacion & { cargaInicial?: boolean }; salida: Simulacion };
  /**
   * Importa productos (crea los nuevos y actualiza los existentes) por tandas; con filas con error se rechaza salvo
   * `omitirErrores`, que exige `lineasOmitidas` (las líneas con error que la persona vio y aceptó omitir): si no coinciden
   * con las de la simulación nueva del servidor no escribe nada y responde `desactualizada`. Si `completa` es `false` sin
   * `desactualizada`, se reintenta con el mismo `operacionId`. El stock solo entra con `cargaInicial`.
   */
  importarProductosCsv: {
    entrada: FuenteImportacion & { operacionId: string; cargaInicial?: boolean } & (
      | { omitirErrores?: false; lineasOmitidas?: undefined }
      | { omitirErrores: true; lineasOmitidas: readonly number[] }
    );
    salida: ResultadoImportacion;
  };
  /** Función pura del módulo expuesta como callable: devuelve el CSV (celdas neutralizadas) de los productos del tenant. */
  exportarProductosCsv: { entrada: Vacio; salida: { csv: string } };
  // ---- Recibos ----
  buscarComprobantes: { entrada: { consulta: ConsultaArchivo }; salida: readonly Recibo[] };
  /** El servidor genera el PDF, lo guarda en una ruta privada y devuelve el enlace `wa.me` (que la persona abre y envía). */
  enviarRecibo: { entrada: { reciboId: string; codigoPais?: string }; salida: ResultadoEnvio };
  referenciarFacturaSuma: { entrada: { reciboId: string; facturaSuma: string }; salida: Ok };
  guardarPlantilla: { entrada: { plantilla: PlantillaRecibo }; salida: Ok };
  // ---- Consola (catálogo y sitio; no crea, edita ni importa productos: eso es de Inventarios) ----
  obtenerTablero: { entrada: Vacio; salida: Tablero };
  publicarSitio: { entrada: Vacio; salida: ResultadoPublicacion };
  /** Un precio por cada mercado declarado por el comercio, en centavos de la moneda base: `inventarios.cambiarPrecioUSD` (idempotente por `operacionId`, que la pantalla manda siempre). */
  cambiarPrecioUSD: { entrada: { operacionId: string; productoId: string; precioUSD: PreciosPorMercado }; salida: Ok };
  guardarFicha: { entrada: { productoId: string; ficha: FichaWeb }; salida: Ok };
  /** `tipo: 'portada'` (solo `adm`) sube una foto al carrusel de portada: `productoId` debe ser `_portada` y el cupo sale del plan. */
  reservarSubida: { entrada: { subidaId: string; productoId: string; tipo: TipoMedio | 'portada'; bytes: number }; salida: Reserva };
  /**
   * Logo del negocio, solo `adm`: misma subida reanudable que las fotos (reservar, subir a `rutaOriginal`, esperar/finalizar), con
   * destino fijo (el panel no manda `productoId`), tope `BYTES_LOGO` y solo JPG, PNG o WebP (el servidor lo valida por contenido).
   * Subir un logo nuevo reemplaza al vigente. Mismas reglas de idempotencia que `reservarSubida`.
   */
  reservarSubidaLogo: { entrada: { subidaId: string; bytes: number }; salida: Reserva };
  estadoSubidaLogo: { entrada: { subidaId: string }; salida: ResultadoEstadoSubidaLogo };
  finalizarSubidaLogo: { entrada: { subidaId: string }; salida: MedioLogo };
  /** Logo vigente del negocio (`sup` y `adm`) o `null` si no hay uno subido. */
  leerLogo: { entrada: Vacio; salida: LogoNegocio | null };
  /** Quita el logo subido (solo `adm`); idempotente: sin logo responde `{ quitado: false }`. No toca la dirección web escrita a mano. */
  quitarLogo: { entrada: Vacio; salida: { quitado: boolean } };
  /** Consulta el estado de una subida sin procesarla (el disparador de Storage la procesa al llegar el original). */
  estadoSubida: { entrada: { subidaId: string }; salida: ResultadoEstadoSubida };
  /** Respaldo: fuerza el procesamiento si el disparador no resolvió la subida (idempotente). */
  finalizarSubida: { entrada: { subidaId: string }; salida: Medio };
  borrarMedio: { entrada: { medioId: string }; salida: Ok };
  guardarSeccion: { entrada: { seccion: Seccion }; salida: Ok };
  eliminarSeccion: { entrada: { seccionId: string }; salida: Ok };
  ordenarSecciones: { entrada: { orden: readonly string[] }; salida: Ok };
  guardarCarrusel: { entrada: { carrusel: Carrusel }; salida: Ok };
  guardarConfigSitio: { entrada: { config: ConfigSitio }; salida: Ok };
  // ---- Identidad (núcleo) ----
  asignarRol: { entrada: { uid: string; rol: Rol }; salida: Ok };
  quitarRol: { entrada: { uid: string }; salida: Ok };
  /**
   * Invita a una persona por correo con un rol reservado (solo `adm`; también puede invitar administradores). La respuesta es
   * SIEMPRE la misma, exista o no la cuenta y pertenezca o no a otro negocio. El correo con el enlace lo envía el panel
   * (`conCorreoDeInvitacion`) tras la respuesta; la invitación ocupa un cupo del plan y caduca a los 7 días.
   */
  invitarUsuario: { entrada: { correo: string; rol: Rol }; salida: { ok: true; mensaje: string } };
  /** Anula una invitación pendiente: libera el cupo. */
  anularInvitacion: { entrada: { uid: string }; salida: Ok };
  /** Extiende 7 días una invitación. `correo` no viaja al servidor: es para reenviar el enlace desde el panel. */
  reenviarInvitacion: { entrada: { uid: string; correo: string }; salida: { ok: true; mensaje: string; venceEnMs: number } };
  /**
   * Busca una cuenta existente por correo para asignarle rol (solo `adm`). Por privacidad responde solo si la cuenta ya es
   * miembro de este negocio o no pertenece a ninguno; en cualquier otro caso responde «no encontrado», igual que si no existiera.
   */
  buscarUsuarioPorCorreo: { entrada: { correo: string }; salida: { uid: string; correoVerificado: boolean; conContrasena: boolean } };
  // ---- Lecturas del panel (sin función pública equivalente) ----
  leerConfigPos: { entrada: Vacio; salida: ConfigPos };
  leerPlantilla: { entrada: Vacio; salida: PlantillaRecibo };
  cotizacionesVigentes: { entrada: Vacio; salida: CotizacionesVigentes };
  /** Con un conteo abierto y rol `caj`/`sup`, la lista lleva `existenciasOcultas` y `conteosAbiertos` (ver `ListaConMarca`). */
  listarProductos: { entrada: Vacio; salida: ListaConMarca<ProductoPanel> };
  listarSeries: { entrada: { productoId: string; ubicacionId?: UbicacionId; soloDisponibles?: boolean }; salida: ListaConMarca<UnidadSerie> };
  buscarSerie: { entrada: { serie: string; productoId?: string; porInicio?: true }; salida: readonly UnidadSerie[] };
  listarMovimientos: {
    entrada: { desde?: string; hasta?: string; productoId?: string; tipo?: TipoMovimiento; usuario?: string; limite?: number };
    /** `cortada`: hay más movimientos que el límite; afine los filtros. */
    salida: ConMarca<{ readonly movimientos: readonly MovimientoVista[]; readonly cortada: boolean }>;
  };
  /** `estado` filtra en el servidor; `cortada` avisa que hay más que el límite. */
  listarMermas: { entrada: { estado?: EstadoMerma }; salida: { readonly mermas: readonly MermaVista[]; readonly cortada: boolean } };
  listarConteos: { entrada: Vacio; salida: readonly ConteoVista[] };
  /** Turno abierto del usuario (o `null`). */
  turnoActual: { entrada: Vacio; salida: TurnoPos | null };
  /** sup/adm: todos los turnos; caj: solo los propios. */
  listarTurnos: { entrada: { estado?: 'abierto' | 'cerrado' }; salida: readonly TurnoPos[] };
  /** caj: solo sus ventas; sup/adm: todas. */
  listarVentas: { entrada: { turnoId?: string; desde?: string; hasta?: string; conSolicitudAnulacion?: boolean }; salida: readonly VentaPos[] };
  /** Resumen por moneda del turno indicado (o del abierto); `null` si no hay turno. */
  resumenTurno: { entrada: { turnoId?: string; cajeroUid?: string }; salida: ResumenTurnoVista | null };
  /** Mis turnos, el más reciente primero, por páginas (`siguiente` es el cursor de la próxima). Fechas aaaa-mm-dd. */
  misTurnos: { entrada: { desde?: string; hasta?: string; cajeroUid?: string; despuesDe?: CursorTurno }; salida: { readonly turnos: readonly FilaTurnoVista[]; readonly siguiente: CursorTurno | null } };
  /** Mis ventas, la más reciente primero, por páginas. Fechas aaaa-mm-dd. */
  misVentas: { entrada: { turnoId?: string; desde?: string; hasta?: string; despuesDe?: CursorVenta }; salida: { readonly ventas: readonly VentaPos[]; readonly siguiente: CursorVenta | null } };
  listarAprobaciones: { entrada: { estado?: 'pendiente' | 'aprobada' | 'rechazada' | 'usada' }; salida: readonly AprobacionPos[] };
  listarMovimientosCaja: { entrada: { turnoId?: string }; salida: readonly MovimientoCaja[] };
  /** Ventas del rango (aaaa-mm-dd) en CSV, con celdas neutralizadas por el servidor (`sup`/`adm`). */
  exportarVentasCsv: { entrada: { desde?: string; hasta?: string }; salida: { csv: string; truncado: boolean } };
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
  /** Ids de los módulos encendidos del negocio (el menú del panel se arma con ellos). */
  modulosActivos: { entrada: Vacio; salida: readonly string[] };
  /** Mercados y monedas del comercio de la sesión (solo lectura). */
  configuracionComercial: { entrada: Vacio; salida: VistaComercial };
}

export type NombreCallable = keyof Contrato;
export type Entrada<N extends NombreCallable> = Contrato[N]['entrada'];
export type Salida<N extends NombreCallable> = Contrato[N]['salida'];

export { NOMBRES_CALLABLE, ROLES_CALLABLE } from './real.js';
