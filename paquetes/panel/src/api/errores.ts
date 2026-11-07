// Errores del contrato y su traducción a mensajes legibles. El servidor real responde con un HttpsError cuyo `code` es el
// de Firebase Functions, cuyo `message` es el del error tipado del módulo (apto para el usuario, en español) y cuyos
// `details` pueden traer `faltantes` (stock), `campos` (rutas inválidas, nunca valores), `detalles` (filas de una
// importación) y `clave`/`tope` (límite del plan). El servidor real envía SIEMPRE `details.codigo` (código del módulo en
// kebab-case): el panel mapea el mensaje por ese código. Si el código no tiene mensaje propio (los del borde, como
// `solicitud-invalida`, o uno nuevo), se usa el mensaje que el servidor controla.

export interface DetalleError {
  readonly codigo?: string;
  /** Faltantes de stock (StockInsuficiente). */
  readonly faltantes?: readonly { readonly productoId: string; readonly almacenId: string; readonly pedido: number; readonly disponible: number }[];
  /** Mensajes por campo o fila (ErrorConsola.detalles). */
  readonly detalles?: readonly string[];
  /** Rutas de los campos inválidos de `datos` (esquema estricto del servidor; nunca los valores). */
  readonly campos?: readonly string[];
  /** Límite del plan alcanzado (`resource-exhausted`). */
  readonly clave?: string;
  readonly tope?: number;
}

export class ErrorApi extends Error {
  constructor(
    readonly codigoHttps: string,
    mensaje: string,
    readonly detalle: DetalleError = {},
  ) {
    super(mensaje);
    this.name = 'ErrorApi';
  }
}

const POR_CODIGO_MODULO: Readonly<Record<string, string>> = {
  // POS
  'entrada-invalida': 'Hay datos que no son válidos. Revise el formulario.',
  'no-autorizado': 'No tiene permiso para esta acción.',
  'dato-corrupto': 'Hay un dato guardado que no se puede leer. Avise al administrador.',
  'sin-turno': 'No hay un turno abierto. Abra el turno para vender.',
  'turno-ajeno': 'El turno abierto es de otra persona.',
  'turno-no-abierto': 'Ese turno ya está cerrado.',
  'turno-ya-abierto': 'Ya hay un turno abierto en la caja.',
  'request-en-uso': 'Esa operación ya se registró con otros datos. Vuelva a empezar.',
  'precio-alterado': 'El precio cambió mientras vendía. Revise el carrito y vuelva a cobrar.',
  'producto-inexistente': 'El producto no existe.',
  'producto-inactivo': 'El producto está inactivo.',
  'sin-precio': 'El producto no tiene precio en esta lista (a consultar).',
  'series-invalidas': 'Indique una serie distinta por cada unidad.',
  'descuento-sin-aprobacion': 'El descuento supera su tope: pida la aprobación de un supervisor.',
  'aprobacion-inexistente': 'La aprobación no existe.',
  'aprobacion-no-aprobada': 'La aprobación todavía no fue aprobada.',
  'aprobacion-usada': 'Esa aprobación ya se usó.',
  'aprobacion-vencida': 'La aprobación venció. Solicite otra.',
  'aprobacion-no-coincide': 'La aprobación no corresponde a este descuento o crédito.',
  autoaprobacion: 'Nadie puede aprobar su propia solicitud.',
  'pagos-invalidos': 'Los pagos no suman el total o no son válidos. Revíselos.',
  'medio-no-habilitado': 'Ese medio de pago no está habilitado.',
  'conteo-faltante': 'Falta contar el efectivo de una moneda.',
  'egreso-excede-efectivo': 'El egreso es mayor que el efectivo disponible en esa moneda.',
  'venta-inexistente': 'La venta no existe.',
  'venta-ya-anulada': 'La venta ya está anulada.',
  'anulacion-sin-solicitud': 'La venta no tiene una solicitud de anulación.',
  'credito-inexistente': 'El crédito no existe.',
  'credito-saldo-insuficiente': 'El cobro es mayor que el saldo del crédito.',
  // Consola
  'no-encontrado': 'No se encontró lo que buscaba.',
  conflicto: 'Eso ya existe o está en uso. Revise los datos.',
  limite: 'Se alcanzó un límite del plan.',
  'cuota-excedida': 'Se superó la cuota de almacenamiento (10 GB).',
  'tipo-no-permitido': 'El archivo no es de un tipo permitido.',
  estado: 'La acción no se puede hacer en el estado actual.',
  'contador-corrupto': 'Hay un contador dañado. Avise al administrador.',
  procesamiento: 'No se pudo procesar el archivo. Pruebe con otro.',
  'no-disponible': 'El servicio no está disponible por ahora. Intente de nuevo más tarde.',
  // Identidad
  anonimo: 'Debe iniciar sesión con su correo.',
  proveedor: 'Esa cuenta no puede iniciar sesión así.',
  claim: 'No se pudo actualizar el rol. Intente de nuevo.',
  'correo-no-verificado': 'Verifica tu correo para continuar.',
  jerarquia: 'Solo el propietario de la plataforma puede cambiar a un administrador.',
  'ultimo-adm': 'No se puede quitar al último administrador.',
  'no-miembro': 'Esa persona no pertenece al negocio.',
  concurrencia: 'Otra persona cambió lo mismo al mismo tiempo. Intente de nuevo.',
  // Inventarios
  'stock-insuficiente': 'No hay existencias suficientes.',
  'serie-no-disponible': 'Esa serie no está disponible en ese almacén.',
  'operacion-conflicto': 'Esa operación ya se hizo con otros datos. Vuelva a empezar.',
  'sin-permiso': 'No tiene permiso para esta acción.',
  'estado-invalido': 'La acción no se puede hacer en el estado actual.',
  'limite-del-plan': 'Se alcanzó el límite del plan.',
  // Recibos
  'recibo-no-encontrado': 'No se encontró el comprobante.',
  'plantilla-invalida': 'La plantilla del recibo tiene datos inválidos.',
  'accion-no-permitida': 'Esa acción no está permitida para este comprobante.',
  // Encendido por tenant (L2-6): el servidor rechaza las acciones de un módulo apagado.
  'modulo-apagado': 'Este módulo no está habilitado para su negocio.',
};

const POR_CODIGO_HTTPS: Readonly<Record<string, string>> = {
  unauthenticated: 'Su sesión venció. Inicie sesión de nuevo.',
  'permission-denied': 'No tiene permiso para esta acción.',
  'invalid-argument': 'Hay datos que no son válidos. Revise el formulario.',
  'not-found': 'No se encontró lo que buscaba.',
  'already-exists': 'Esa operación ya se hizo con otros datos.',
  'failed-precondition': 'La acción no se puede hacer en este momento.',
  'resource-exhausted': 'Se alcanzó un límite. Intente más tarde.',
  unavailable: 'No hay conexión con el servidor. Revise su internet e intente de nuevo.',
  'deadline-exceeded': 'El servidor tardó demasiado. Intente de nuevo.',
  internal: 'Ocurrió un error inesperado. Intente de nuevo.',
};

/**
 * Códigos HTTPS cuyo `message` el servidor controla (errores tipados de los módulos, aptos para el usuario). Los demás
 * (`internal`, `unavailable`, `unauthenticated`, `aborted`…) llevan texto genérico o técnico y se reemplazan por el del panel.
 */
const CON_MENSAJE_DEL_SERVIDOR: ReadonlySet<string> = new Set(['failed-precondition', 'not-found', 'already-exists', 'permission-denied', 'invalid-argument', 'resource-exhausted']);

/**
 * Códigos del módulo cuyo texto fijo del panel es demasiado vago: se prefiere el mensaje preciso del servidor
 * («Falta el motivo», «El conteo c1 no está abierto»…) cuando existe y es de los que el servidor controla.
 */
const PREFIERE_MENSAJE_DEL_SERVIDOR: ReadonlySet<string> = new Set(['entrada-invalida', 'estado', 'estado-invalido', 'no-encontrado']);

export const MENSAJE_GENERICO = 'Ocurrió un error inesperado. Intente de nuevo.';

/** Mensaje legible para cualquier error (nunca el texto técnico del servidor). */
export function mensajeDeError(e: unknown): string {
  if (!(e instanceof ErrorApi)) return MENSAJE_GENERICO;
  const delServidorDisponible = CON_MENSAJE_DEL_SERVIDOR.has(e.codigoHttps) && e.message.trim() !== '' ? e.message.trim() : undefined;
  const codigo = e.detalle.codigo;
  let modulo = codigo === undefined ? undefined : POR_CODIGO_MODULO[codigo];
  if (codigo !== undefined && PREFIERE_MENSAJE_DEL_SERVIDOR.has(codigo) && delServidorDisponible !== undefined) modulo = delServidorDisponible;
  // El mismo código sirve al egreso de caja y al reembolso de una anulación: se distinguen por el mensaje del servidor.
  if (codigo === 'egreso-excede-efectivo' && /reembolso/i.test(e.message)) modulo = 'El reembolso en efectivo es mayor que el efectivo disponible en esa moneda de la caja.';
  // El mismo código sirve al descuento y a la anulación: la anulación se distingue por el mensaje del servidor.
  if (codigo === 'autoaprobacion' && /anulaci[oó]n/i.test(e.message)) modulo = 'No puedes aprobar la anulación de una venta que vendiste o pediste anular';
  const delServidor = modulo === undefined ? delServidorDisponible : undefined;
  let base = modulo ?? delServidor ?? POR_CODIGO_HTTPS[e.codigoHttps] ?? MENSAJE_GENERICO;
  const sinCodigoConFaltantes = e.detalle.codigo === undefined && e.codigoHttps === 'failed-precondition';
  if ((e.detalle.codigo === 'stock-insuficiente' || sinCodigoConFaltantes) && e.detalle.faltantes !== undefined && e.detalle.faltantes.length > 0) {
    if (sinCodigoConFaltantes) base = POR_CODIGO_MODULO['stock-insuficiente'] ?? base;
    const f = e.detalle.faltantes.map((x) => `${x.productoId} en ${x.almacenId}: pidió ${x.pedido}, hay ${x.disponible}`).join('; ');
    base = `${base} ${f}.`;
  }
  if (e.detalle.detalles !== undefined && e.detalle.detalles.length > 0) base = `${base} ${e.detalle.detalles.join(' ')}`;
  return base;
}

/** Códigos del módulo conocidos (para pruebas de que cada código tiene mensaje). */
export const CODIGOS_CONOCIDOS: readonly string[] = Object.keys(POR_CODIGO_MODULO);
