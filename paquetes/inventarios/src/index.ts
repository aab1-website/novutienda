export { manifiestoInventarios } from './manifiesto.js';

// Puerto que consumen el POS y los pedidos (dentro de SU transacción).
export { aplicarReversion, aplicarSalida, hashSalida, idOperacionReversion, idOperacionSalida, prepararReversion, prepararSalida } from './puerto.js';
export type { LineaResuelta, LineaSalida, OpcionesSalida, PlanReversion, PlanSalida, ReferenciaSalida } from './puerto.js';

// Errores tipados.
export {
  EntradaInvalida, ErrorInventario, EstadoInvalido, NoEncontrado, OperacionConflicto, ProductoInactivo, SerieNoDisponible, SinPermiso, StockInsuficiente,
} from './errores.js';
export type { CodigoError, Faltante } from './errores.js';

// Operaciones.
export { esDisponible, skuDesdeId, UBICACION_DISPONIBILIDAD } from './disponibilidad.js';
export {
  leerDocumentoProducto, leerExistencias, leerProducto, ProductoCorrupto, rutaColeccionProductos,
} from './lectura.js';
export type { ExistenciaLeida, ProductoLeido } from './lectura.js';
export { actualizarProducto, crearProducto, crearUbicacion, validarEntradaProducto } from './productos.js';
export type { CambiosProducto, EntradaCrearProducto, EntradaProducto, PrecioUSD } from './productos.js';
export { ajustar, ingresar, traspasar } from './stock.js';
export type { LineaAjuste, LineaIngreso, LineaTraspaso } from './stock.js';
export { resolverMerma, solicitarMerma } from './merma.js';
export { abrirConteo, cerrarConteo, registrarLineaConteo } from './conteo.js';
export {
  analizarCsv, exportarProductosCsv, importarCsvPorLotes, importarProductosCsv, leerCsvFilas, leerCsvProductos, MAX_FILAS_IMPORTACION, neutralizarCelda, simularImportacionCsv,
} from './importacion.js';
export type { BaseTransaccional, ErrorFila, FilaImportada, FilaSimulada, ProductoExportable, ResultadoImportacion, Simulacion } from './importacion.js';
export { PERMISOS } from './operacion.js';
export type { ResultadoOperacion } from './operacion.js';

// Eventos y endpoint firmado.
export {
  ACTOR_SISTEMA, confirmarPedido, confirmarPedidoFirmado, consumirPedidoConfirmado, consumirVentaAnulada, ejecutorDesde, leerCuerpoPedido,
} from './pedido.js';
export type { ItemPedido, RespuestaHttp, ResultadoPedido, SolicitudConfirmarPedido, TransaccionInventario } from './pedido.js';

// Utilidades de dominio.
export { esIdSegmento, esProductoId, esSerie, esUbicacionId, UBICACIONES } from './ids.js';
export type { UbicacionId } from './ids.js';
export type { Autor } from './motor.js';
/** Solo para pruebas: fija el reloj con el que se estampan los planes. */
export { fijarReloj, fechaLocal, ZONA_HORARIA_POR_DEFECTO } from './motor.js';
