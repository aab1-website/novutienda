import { esMercadoDe, monedaBaseDe, monedaDe, type TransaccionIdentidad } from '@novutienda/nucleo';
import {
  ahoraDe, auditar, exigirActor, exigirCentavos, exigirConfiguracionSoportada, exigirTenant, exigirTexto, exigirUuid, leerObligatorio, rutaCarrito, rutaTurno, rutaVenta,
  type DepsPos,
} from './contexto.js';
import { ErrorPos } from './errores.js';
import { leerCarrito, leerCarritosAbiertos } from './lectura.js';
import {
  ALMACENES_POS, MAX_CANTIDAD_LINEA, MAX_CARRITOS_ABIERTOS, MAX_LINEAS_CARRITO, MAX_SERIES_POR_VENTA,
  type ActorPos, type CarritoPos, type ContenidoCarrito, type LineaCarritoGuardada,
} from './tipos.js';
import { leerTurnoAbierto } from './turno-activo.js';

type Datos = Readonly<Record<string, unknown>>;

const MAX_ETIQUETA = 40;
const esObjeto = (x: unknown): x is Datos => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Valida y normaliza lo que el cajero guarda. No exige líneas (un carrito recién abierto está vacío); el cobro sí las exige. */
export function validarContenido(deps: DepsPos, x: unknown): ContenidoCarrito {
  if (!esObjeto(x)) throw new ErrorPos('entrada-invalida', 'El contenido del carrito es inválido');
  const { comercial } = deps;
  const mercadoId = x['mercadoId'];
  if (typeof mercadoId !== 'string' || !esMercadoDe(comercial, mercadoId)) throw new ErrorPos('entrada-invalida', 'El mercado no es uno de los que declara el comercio');
  const moneda = x['moneda'];
  if (typeof moneda !== 'string' || !comercial.monedas.includes(moneda)) throw new ErrorPos('entrada-invalida', 'moneda inválida');
  if (moneda !== monedaDe(comercial, mercadoId) && moneda !== monedaBaseDe(comercial, mercadoId)) {
    throw new ErrorPos('entrada-invalida', 'La moneda no corresponde a la lista de precios del mercado');
  }
  const crudas = x['lineas'];
  if (!Array.isArray(crudas) || crudas.length > MAX_LINEAS_CARRITO) {
    throw new ErrorPos('entrada-invalida', `El carrito admite hasta ${MAX_LINEAS_CARRITO} líneas`);
  }
  const vistas = new Set<string>();
  let totalSeries = 0;
  const lineas: LineaCarritoGuardada[] = [];
  for (const l of crudas as unknown[]) {
    if (!esObjeto(l)) throw new ErrorPos('entrada-invalida', 'Línea inválida');
    const productoId = l['productoId'];
    if (typeof productoId !== 'string' || productoId === '' || productoId.length > 128 || productoId.includes('/')) throw new ErrorPos('entrada-invalida', 'productoId inválido');
    const cantidad = l['cantidad'];
    if (typeof cantidad !== 'number' || !Number.isSafeInteger(cantidad) || cantidad < 1 || cantidad > MAX_CANTIDAD_LINEA) {
      throw new ErrorPos('entrada-invalida', 'La cantidad debe ser un entero positivo');
    }
    const almacenId = l['almacenId'] ?? 'tienda';
    if (typeof almacenId !== 'string' || !ALMACENES_POS.includes(almacenId)) throw new ErrorPos('entrada-invalida', 'Almacén desconocido');
    const clave = `${almacenId}/${productoId}`;
    if (vistas.has(clave)) throw new ErrorPos('entrada-invalida', 'Un producto no puede repetirse en el mismo almacén; sume las cantidades');
    vistas.add(clave);
    const series = l['series'] ?? [];
    if (!Array.isArray(series) || series.some((s: unknown) => typeof s !== 'string' || s.trim() === '' || s.length > 100)) {
      throw new ErrorPos('series-invalidas', 'Las series deben ser una lista de textos no vacíos de hasta 100 caracteres');
    }
    totalSeries += series.length;
    lineas.push({ productoId, almacenId, cantidad, series: series as string[] });
  }
  if (totalSeries > MAX_SERIES_POR_VENTA) throw new ErrorPos('series-invalidas', `Una venta admite hasta ${MAX_SERIES_POR_VENTA} unidades con serie`);
  const r: { -readonly [K in keyof ContenidoCarrito]: ContenidoCarrito[K] } = { mercadoId, moneda, lineas };
  const d = x['descuento'];
  if (d !== undefined) {
    if (!esObjeto(d)) throw new ErrorPos('entrada-invalida', 'descuento inválido');
    r.descuento = { monto: exigirCentavos(d['monto'], 'descuento.monto', 1), motivo: exigirTexto(d['motivo'], 'El motivo del descuento') };
  }
  const c = x['cliente'];
  if (c !== undefined) {
    if (!esObjeto(c)) throw new ErrorPos('entrada-invalida', 'cliente inválido');
    const telefono = c['telefono'];
    r.cliente = { nombre: exigirTexto(c['nombre'], 'cliente.nombre', 100), ...(telefono !== undefined ? { telefono: exigirTexto(telefono, 'cliente.telefono', 30) } : {}) };
  }
  for (const k of ['aprobacionDescuentoId', 'solicitudDescuentoId', 'solicitudCreditoId'] as const) {
    if (x[k] !== undefined) r[k] = exigirUuid(x[k], k);
  }
  return r;
}

function aDocumento(c: CarritoPos): Record<string, unknown> {
  return c as unknown as Record<string, unknown>;
}

/** Cierra un carrito: borra el contenido (datos personales) y sube la versión. */
function sinContenido(c: CarritoPos): Record<string, unknown> {
  const { contenido: _borrado, ...resto } = aDocumento(c) as { contenido?: unknown } & Record<string, unknown>;
  void _borrado;
  return resto;
}

/** Lee los carritos del índice del turno (como mucho 10), dentro de la transacción. */
export async function leerCarritosDeIndice(tx: TransaccionIdentidad, tenantId: string, ids: readonly string[]): Promise<CarritoPos[]> {
  const r: CarritoPos[] = [];
  for (const id of ids) {
    const raw = await leerObligatorio(tx, rutaCarrito(tenantId, id));
    if (raw !== undefined) r.push(leerCarrito(raw));
  }
  return r;
}

/** Cancela en la transacción un carrito abierto (sin tocar el índice del turno: lo hace quien llama). */
export function escribirCancelado(tx: TransaccionIdentidad, tenantId: string, actor: ActorPos, c: CarritoPos, motivo: string, ahora: number, accion: string): CarritoPos {
  const nuevo = {
    ...sinContenido(c), estado: 'cancelado', version: c.version + 1, actualizadoEnMs: ahora, cerradoEnMs: ahora, motivoCancelacion: motivo, canceladoPor: actor.uid,
  } as unknown as CarritoPos;
  tx.set(rutaCarrito(tenantId, c.carritoId), aDocumento(nuevo));
  auditar(tx, tenantId, actor, {
    accion,
    ruta: rutaCarrito(tenantId, c.carritoId),
    antes: { estado: 'abierto', cajeroUid: c.cajeroUid },
    despues: { estado: 'cancelado', canceladoPor: actor.uid },
    motivo,
  });
  return nuevo;
}

/** Escribe el carrito como cerrado por una venta (lo llama `confirmarVenta`). */
export function escribirCerrado(tx: TransaccionIdentidad, tenantId: string, c: CarritoPos, ventaId: string, ahora: number): void {
  const nuevo = { ...sinContenido(c), estado: 'cerrado', version: c.version + 1, actualizadoEnMs: ahora, cerradoEnMs: ahora, ventaId };
  tx.set(rutaCarrito(tenantId, c.carritoId), nuevo);
}

/** Carrito abierto y del actor, o el error que corresponda. */
export function exigirCarritoAbiertoDe(c: CarritoPos | undefined, actor: ActorPos): CarritoPos {
  if (c === undefined) throw new ErrorPos('carrito-inexistente', 'El carrito no existe');
  if (c.cajeroUid !== actor.uid) throw new ErrorPos('carrito-ajeno', 'El carrito es de otro usuario');
  if (c.estado !== 'abierto') throw new ErrorPos('carrito-cerrado', 'El carrito ya no está abierto');
  return c;
}

export function conflictoDeVersion(c: CarritoPos): ErrorPos {
  return new ErrorPos('carrito-conflicto', 'El carrito cambió desde otra pantalla: se muestra la versión vigente', { carrito: aDocumento(c) });
}

/** Abre un carrito en el turno abierto del actor (idempotente por `carritoId`). Máximo 10 abiertos por turno. */
export async function crearCarrito(deps: DepsPos, tenantId: string, actor: ActorPos, carritoIdEntrada: string, etiquetaEntrada?: string): Promise<CarritoPos> {
  exigirTenant(tenantId);
  exigirActor(actor);
  exigirConfiguracionSoportada(deps);
  const carritoId = exigirUuid(carritoIdEntrada, 'carritoId');
  const etiqueta = etiquetaEntrada === undefined ? undefined : exigirTexto(etiquetaEntrada, 'etiqueta', MAX_ETIQUETA);
  const ahora = ahoraDe(deps);
  return deps.db.runTransaction(async (tx) => {
    const previo = await leerObligatorio(tx, rutaCarrito(tenantId, carritoId));
    if (previo !== undefined) {
      const c = leerCarrito(previo);
      if (c.cajeroUid !== actor.uid) throw new ErrorPos('request-en-uso', 'Ese identificador de carrito ya se usó');
      return c;
    }
    // El carritoId será el ventaId: si ya hay una venta con ese id, el carrito chocaría con ella.
    if ((await leerObligatorio(tx, rutaVenta(tenantId, carritoId))) !== undefined) throw new ErrorPos('request-en-uso', 'Ese identificador ya se usó en una venta');
    const abierto = await leerTurnoAbierto(tx, tenantId, deps.comercial.monedas);
    if (abierto === undefined) throw new ErrorPos('sin-turno', 'No hay un turno abierto: abra el turno antes de usar carritos');
    if (abierto.turno.cajeroUid !== actor.uid) throw new ErrorPos('turno-ajeno', 'El turno abierto es de otro usuario');
    const ids = leerCarritosAbiertos(abierto.raw) ?? [];
    if (ids.length >= MAX_CARRITOS_ABIERTOS) {
      throw new ErrorPos('limite-carritos', `Hay ${MAX_CARRITOS_ABIERTOS} carritos abiertos: cobre o cancele alguno antes de abrir otro`);
    }
    let nombre = etiqueta;
    if (nombre === undefined) {
      const usadas = new Set((await leerCarritosDeIndice(tx, tenantId, ids)).map((c) => c.etiqueta));
      let n = 1;
      while (usadas.has(`Cliente ${n}`)) n += 1;
      nombre = `Cliente ${n}`;
    }
    const carrito: CarritoPos = {
      carritoId,
      turnoId: abierto.turno.turnoId,
      cajeroUid: actor.uid,
      estado: 'abierto',
      etiqueta: nombre,
      version: 1,
      // Fijo y derivado del carrito: será el ventaId, así el cobro es idempotente y el cliente no necesita pedirlo.
      requestId: carritoId,
      creadoEnMs: ahora,
      actualizadoEnMs: ahora,
    };
    tx.set(rutaCarrito(tenantId, carritoId), aDocumento(carrito));
    tx.set(rutaTurno(tenantId, abierto.turno.turnoId), { ...abierto.raw, carritosAbiertos: [...ids, carritoId] });
    auditar(tx, tenantId, actor, {
      accion: 'pos.carrito.crear',
      ruta: rutaCarrito(tenantId, carritoId),
      despues: { turnoId: abierto.turno.turnoId },
    });
    return carrito;
  });
}

export interface CambiosCarrito {
  readonly contenido?: unknown | undefined;
  readonly etiqueta?: string | undefined;
}

/** Guarda el contenido o la etiqueta de un carrito propio y abierto. Control optimista por `version`. No audita cada guardado. */
export async function guardarCarrito(
  deps: DepsPos,
  tenantId: string,
  actor: ActorPos,
  carritoIdEntrada: string,
  version: number,
  cambios: CambiosCarrito,
): Promise<CarritoPos> {
  exigirTenant(tenantId);
  exigirActor(actor);
  exigirConfiguracionSoportada(deps);
  const carritoId = exigirUuid(carritoIdEntrada, 'carritoId');
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) throw new ErrorPos('entrada-invalida', 'version inválida');
  if (cambios.contenido === undefined && cambios.etiqueta === undefined) throw new ErrorPos('entrada-invalida', 'No hay nada que guardar');
  const contenido = cambios.contenido === undefined ? undefined : validarContenido(deps, cambios.contenido);
  const etiqueta = cambios.etiqueta === undefined ? undefined : exigirTexto(cambios.etiqueta, 'etiqueta', MAX_ETIQUETA);
  const ahora = ahoraDe(deps);
  return deps.db.runTransaction(async (tx) => {
    const raw = await leerObligatorio(tx, rutaCarrito(tenantId, carritoId));
    const c = exigirCarritoAbiertoDe(raw === undefined ? undefined : leerCarrito(raw), actor);
    if (c.version !== version) throw conflictoDeVersion(c);
    const nuevo: CarritoPos = {
      ...c,
      version: c.version + 1,
      actualizadoEnMs: ahora,
      ...(etiqueta !== undefined ? { etiqueta } : {}),
      ...(contenido !== undefined ? { contenido } : {}),
    };
    tx.set(rutaCarrito(tenantId, carritoId), aDocumento(nuevo));
    return nuevo;
  });
}

/**
 * Cancela un carrito abierto con motivo. Lo puede hacer el dueño y, para los ajenos, `sup` y `adm` (auditado con quién y por qué).
 * Repetir sobre uno ya cancelado devuelve el mismo estado; uno cobrado no se cancela.
 */
export async function cancelarCarrito(deps: DepsPos, tenantId: string, actor: ActorPos, carritoIdEntrada: string, motivoEntrada: string): Promise<CarritoPos> {
  exigirTenant(tenantId);
  exigirActor(actor);
  exigirConfiguracionSoportada(deps);
  const carritoId = exigirUuid(carritoIdEntrada, 'carritoId');
  const motivo = exigirTexto(motivoEntrada, 'motivo');
  const ahora = ahoraDe(deps);
  return deps.db.runTransaction(async (tx) => {
    const raw = await leerObligatorio(tx, rutaCarrito(tenantId, carritoId));
    if (raw === undefined) throw new ErrorPos('carrito-inexistente', 'El carrito no existe');
    const c = leerCarrito(raw);
    if (c.cajeroUid !== actor.uid && actor.rol === 'caj') throw new ErrorPos('carrito-ajeno', 'El carrito es de otro usuario');
    if (c.estado === 'cancelado') return c;
    if (c.estado !== 'abierto') throw new ErrorPos('carrito-cerrado', 'El carrito ya se cobró');
    const turnoRaw = await leerObligatorio(tx, rutaTurno(tenantId, c.turnoId));
    const ids = turnoRaw === undefined ? undefined : leerCarritosAbiertos(turnoRaw);
    const cancelado = escribirCancelado(tx, tenantId, actor, c, motivo, ahora, 'pos.carrito.cancelar');
    if (turnoRaw !== undefined && ids !== undefined) tx.set(rutaTurno(tenantId, c.turnoId), { ...turnoRaw, carritosAbiertos: ids.filter((i) => i !== carritoId) });
    return cancelado;
  });
}

/** Carritos abiertos del turno abierto del propio actor (con su contenido). Sin turno propio, lista vacía. */
export async function misCarritos(deps: DepsPos, tenantId: string, actor: ActorPos): Promise<{ carritos: CarritoPos[] }> {
  exigirTenant(tenantId);
  exigirActor(actor);
  return deps.db.runTransaction(async (tx) => {
    const abierto = await leerTurnoAbierto(tx, tenantId, deps.comercial.monedas);
    if (abierto === undefined || abierto.turno.cajeroUid !== actor.uid) return { carritos: [] };
    const ids = leerCarritosAbiertos(abierto.raw) ?? [];
    const todos = await leerCarritosDeIndice(tx, tenantId, ids);
    return { carritos: todos.filter((c) => c.estado === 'abierto').sort((a, b) => a.creadoEnMs - b.creadoEnMs) };
  });
}

/** Resumen para supervisión: sin cliente ni teléfono ni series. */
export interface ResumenCarrito {
  readonly carritoId: string;
  readonly etiqueta: string;
  readonly cajeroUid: string;
  readonly lineas: number;
  readonly unidades: number;
  readonly creadoEnMs: number;
  readonly actualizadoEnMs: number;
  /** Milisegundos desde que se abrió, a la hora `ahora` que se pasa. */
  readonly antiguedadMs: number;
}

export function resumirCarrito(c: CarritoPos, ahora: number): ResumenCarrito {
  const lineas = c.contenido?.lineas ?? [];
  return {
    carritoId: c.carritoId,
    etiqueta: c.etiqueta,
    cajeroUid: c.cajeroUid,
    lineas: lineas.length,
    unidades: lineas.reduce((s, l) => s + l.cantidad, 0),
    creadoEnMs: c.creadoEnMs,
    actualizadoEnMs: c.actualizadoEnMs,
    antiguedadMs: Math.max(0, ahora - c.creadoEnMs),
  };
}
