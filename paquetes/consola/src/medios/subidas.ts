import { registrarAuditoria, type Actor, type TransaccionIdentidad } from '@novutienda/nucleo';
import { anotarCambio, leerEstadoSitio } from '../cambios.js';
import { ErrorConsola, type CodigoErrorConsola } from '../errores.js';
import { LIMITES_CONSOLA } from '../limites.js';
import { exigirRol, ROLES } from '../permisos.js';
import { PLANTILLAS } from '../plantillas.js';
import type { AlmacenMedios, BaseDatosConsola, CatalogoPuerto, ConsultaSubidas, ProcesadorMedios, Reloj } from '../puertos.js';
import {
  dirTemporal, ID_PRODUCTO, ID_SUBIDA, rutaCarrusel, rutaFicha, rutaMedio, rutaOriginal, rutaPublicaMedio, rutaSeccion, rutaSitio,
  rutaSubida, tenantValido,
} from '../rutas.js';
import { mediosDeSeccion, validarSeccion } from '../secciones.js';
import { esObjeto } from '../validar.js';
import { contieneMetadatos } from './metadatos.js';
import { nombreVersion, planificarProcesamiento, type ItemPlan, type PlanProcesamiento } from './plan.js';
import { BYTES_INICIALES, detectarArchivo, type FormatoArchivo, type TipoMedio } from './tipos-archivo.js';
import { escribirUsoMedios, leerUsoMedios, liberarEnUso, reservarEnUso } from './uso.js';

export interface DepsMedios {
  readonly db: BaseDatosConsola;
  readonly almacen: AlmacenMedios;
  readonly procesador: ProcesadorMedios;
  readonly catalogo: CatalogoPuerto;
  readonly reloj: Reloj;
}

/** Tope de una versión procesada de imagen que se lee completa para buscar metadatos. */
const MAX_BYTES_VERSION_IMAGEN = 8 * 1024 * 1024;

type EstadoSubida = 'reservada' | 'procesada' | 'borrando' | 'rechazada';
type Destino = 'eliminar' | 'rechazada' | 'vencida';

interface Subida {
  readonly id: string;
  readonly productoId: string;
  readonly tipo: TipoMedio;
  readonly bytes: number;
  readonly estado: EstadoSubida;
  readonly rutaOriginal: string;
  readonly creadaEn: number;
  readonly venceEn: number;
  readonly por: string;
  readonly destino?: Destino;
  readonly motivo?: string;
  readonly rutas?: readonly string[];
}

function leerSubida(d: Readonly<Record<string, unknown>> | undefined): Subida | undefined {
  if (d === undefined) return undefined;
  const { id, productoId, tipo, bytes, estado, creadaEn, venceEn, por } = d;
  if (
    typeof id !== 'string' || typeof productoId !== 'string' || (tipo !== 'foto' && tipo !== 'video') ||
    typeof bytes !== 'number' || typeof creadaEn !== 'number' || typeof venceEn !== 'number' || typeof por !== 'string' ||
    typeof d['rutaOriginal'] !== 'string' ||
    (estado !== 'reservada' && estado !== 'procesada' && estado !== 'borrando' && estado !== 'rechazada')
  ) {
    throw new ErrorConsola('estado', 'Registro de subida dañado');
  }
  const destino = d['destino'];
  const rutas = d['rutas'];
  const motivo = d['motivo'];
  return {
    id, productoId, tipo, bytes, estado, creadaEn, venceEn, por, rutaOriginal: d['rutaOriginal'],
    ...(destino === 'eliminar' || destino === 'rechazada' || destino === 'vencida' ? { destino } : {}),
    ...(typeof motivo === 'string' ? { motivo } : {}),
    ...(Array.isArray(rutas) ? { rutas: rutas.filter((r): r is string => typeof r === 'string') } : {}),
  };
}

const aDoc = (s: Subida): Record<string, unknown> => ({ ...s });

// ---------------------------------------------------------------------------------------------
// Reserva
// ---------------------------------------------------------------------------------------------

export interface EntradaReserva {
  readonly tenantId: string;
  readonly actor: Actor;
  /** Identificador generado por el cliente (reintentar la misma reserva no duplica nada). */
  readonly subidaId: string;
  readonly productoId: string;
  readonly tipo: TipoMedio;
  readonly bytes: number;
}

export interface Reserva {
  readonly subidaId: string;
  /** Ruta privada a la que el cliente sube (subida reanudable). */
  readonly rutaOriginal: string;
  readonly venceEn: number;
}

/**
 * Reserva una subida: verifica rol, tope de 5 fotos y 1 video por producto y cuota de 10 GB, todo
 * en UNA transacción (las reservas pendientes cuentan, así dos subidas concurrentes no pasan el tope).
 */
export async function reservarSubida(deps: DepsMedios, e: EntradaReserva): Promise<Reserva> {
  const t = tenantValido(e.tenantId);
  exigirRol(e.actor, t, ROLES.editarFichas);
  if (!ID_SUBIDA.test(e.subidaId)) throw new ErrorConsola('entrada-invalida', 'subidaId inválido');
  if (!ID_PRODUCTO.test(e.productoId)) throw new ErrorConsola('entrada-invalida', 'productoId inválido');
  if (e.tipo !== 'foto' && e.tipo !== 'video') throw new ErrorConsola('entrada-invalida', 'tipo debe ser foto o video');
  if (!Number.isSafeInteger(e.bytes) || e.bytes <= 0) throw new ErrorConsola('entrada-invalida', 'tamaño inválido');
  if (e.tipo === 'foto' && e.bytes > LIMITES_CONSOLA.bytesFoto) throw new ErrorConsola('limite', 'La foto supera 15 MB');
  if (e.tipo === 'video' && e.bytes > LIMITES_CONSOLA.bytesVideo) throw new ErrorConsola('limite', 'El video supera 200 MB');
  if ((await deps.catalogo.leerProducto(t, e.productoId)) === undefined) {
    throw new ErrorConsola('no-encontrado', 'El producto no existe');
  }
  const ahora = deps.reloj.ahora();
  const ruta = rutaOriginal(t, e.productoId, e.subidaId);

  return deps.db.runTransaction(async (tx) => {
    const previa = leerSubida((await tx.get(rutaSubida(t, e.subidaId))).data());
    const uso = await leerUsoMedios(tx, t);
    if (previa !== undefined) {
      if (previa.productoId === e.productoId && previa.tipo === e.tipo && previa.bytes === e.bytes && previa.estado === 'reservada') {
        return { subidaId: previa.id, rutaOriginal: previa.rutaOriginal, venceEn: previa.venceEn };
      }
      throw new ErrorConsola('conflicto', 'Ya existe una subida con ese identificador');
    }
    escribirUsoMedios(tx, t, reservarEnUso(uso, e.productoId, e.tipo, e.bytes));
    const venceEn = ahora + LIMITES_CONSOLA.vigenciaReservaMs;
    const s: Subida = {
      id: e.subidaId, productoId: e.productoId, tipo: e.tipo, bytes: e.bytes, estado: 'reservada',
      rutaOriginal: ruta, creadaEn: ahora, venceEn, por: e.actor.uid,
    };
    tx.set(rutaSubida(t, e.subidaId), aDoc(s));
    return { subidaId: e.subidaId, rutaOriginal: ruta, venceEn };
  });
}

// ---------------------------------------------------------------------------------------------
// Finalización: validación de bytes, procesamiento y publicación de versiones
// ---------------------------------------------------------------------------------------------

export interface EntradaFinalizar {
  readonly tenantId: string;
  readonly actor: Actor;
  readonly subidaId: string;
}

export interface VersionMedio {
  readonly clase: 'imagen' | 'video' | 'poster';
  readonly lado: number;
  readonly formato: 'avif' | 'webp' | 'mp4';
  /** Ruta pública con hash de contenido. */
  readonly ruta: string;
  readonly bytes: number;
}

export interface Medio {
  readonly id: string;
  readonly productoId: string;
  readonly tipo: TipoMedio;
  readonly formatoOriginal: FormatoArchivo;
  readonly bytesOriginal: number;
  readonly rutaOriginal: string;
  readonly ancho: number;
  readonly alto: number;
  readonly duracionSeg?: number;
  readonly versiones: readonly VersionMedio[];
  readonly creadoEn: number;
  readonly por: string;
}

/** Libera la reserva y borra lo subido. Siempre termina lanzando el error que ve el usuario. */
async function rechazar(
  deps: DepsMedios, t: string, s: Subida, codigo: CodigoErrorConsola, motivo: string, extras: readonly string[],
): Promise<never> {
  const rutas = [s.rutaOriginal, ...extras];
  await deps.db.runTransaction(async (tx) => {
    const actual = leerSubida((await tx.get(rutaSubida(t, s.id))).data());
    const uso = await leerUsoMedios(tx, t);
    if (actual?.estado !== 'reservada') return; // otra ejecución ya la resolvió
    escribirUsoMedios(tx, t, liberarEnUso(uso, s.productoId, s.tipo, s.bytes));
    tx.set(rutaSubida(t, s.id), aDoc({ ...actual, estado: 'borrando', destino: 'rechazada', motivo, rutas }));
  });
  await borrarYCerrar(deps, t, s.id);
  throw new ErrorConsola(codigo, motivo);
}

/** Borra los objetos de una subida en estado `borrando` y la cierra (`rechazada`) o la elimina. */
async function borrarYCerrar(deps: DepsMedios, t: string, subidaId: string): Promise<void> {
  const s = leerSubida((await leerDoc(deps.db, rutaSubida(t, subidaId))));
  if (s?.estado !== 'borrando') return;
  await deps.almacen.borrar(s.rutas ?? [s.rutaOriginal]);
  await deps.db.runTransaction(async (tx) => {
    const actual = leerSubida((await tx.get(rutaSubida(t, subidaId))).data());
    if (actual?.estado !== 'borrando') return;
    if (actual.destino === 'rechazada') {
      const { rutas: _r, ...resto } = actual;
      void _r;
      tx.set(rutaSubida(t, subidaId), aDoc({ ...resto, estado: 'rechazada' }));
    } else tx.delete(rutaSubida(t, subidaId));
  });
}

async function leerDoc(db: BaseDatosConsola, ruta: string): Promise<Readonly<Record<string, unknown>> | undefined> {
  return db.runTransaction(async (tx) => (await tx.get(ruta)).data());
}

function validarSalida(plan: PlanProcesamiento, versiones: readonly { clase: string; lado: number; formato: string; rutaTemporal: string }[], dir: string): string | undefined {
  if (versiones.length !== plan.items.length) return 'el procesamiento no produjo exactamente las versiones del plan';
  for (const item of plan.items) {
    const n = versiones.filter((v) => v.clase === item.clase && v.lado === item.lado && v.formato === item.formato).length;
    if (n !== 1) return 'el procesamiento no produjo exactamente las versiones del plan';
  }
  if (versiones.some((v) => !v.rutaTemporal.startsWith(`${dir}/`) || v.rutaTemporal.includes('..'))) {
    return 'el procesamiento escribió fuera de su carpeta temporal';
  }
  return undefined;
}

/**
 * Finaliza una subida ya cargada a la ruta privada: comprueba tamaño real, tipo real por los bytes iniciales
 * (no la extensión ni el MIME), dimensiones y duración, procesa, verifica que no queden metadatos y publica
 * las versiones con hash de contenido. Si algo falla se libera la reserva y se borra el original.
 */
export async function finalizarSubida(deps: DepsMedios, e: EntradaFinalizar): Promise<Medio> {
  const t = tenantValido(e.tenantId);
  const rol = exigirRol(e.actor, t, ROLES.editarFichas);
  if (!ID_SUBIDA.test(e.subidaId)) throw new ErrorConsola('entrada-invalida', 'subidaId inválido');
  const s = leerSubida(await leerDoc(deps.db, rutaSubida(t, e.subidaId)));
  if (s === undefined) throw new ErrorConsola('no-encontrado', 'La subida no existe');
  if (s.estado === 'procesada') {
    const m = await leerDoc(deps.db, rutaMedio(t, s.id));
    if (m !== undefined) return m as unknown as Medio;
  }
  if (s.estado !== 'reservada') throw new ErrorConsola('estado', 'La subida ya no está pendiente');
  if (deps.reloj.ahora() > s.venceEn) throw new ErrorConsola('estado', 'La reserva de subida venció; reserve de nuevo');

  const tope = s.tipo === 'foto' ? LIMITES_CONSOLA.bytesFoto : LIMITES_CONSOLA.bytesVideo;
  const real = await deps.almacen.tamano(s.rutaOriginal);
  if (real === undefined) throw new ErrorConsola('no-encontrado', 'El archivo todavía no llegó');
  if (real === 0) return rechazar(deps, t, s, 'entrada-invalida', 'El archivo está vacío', []);
  if (real > s.bytes || real > tope) {
    return rechazar(deps, t, s, 'limite', s.tipo === 'foto' ? 'La foto supera 15 MB' : 'El video supera 200 MB', []);
  }

  const detectado = detectarArchivo(await deps.almacen.leerInicio(s.rutaOriginal, BYTES_INICIALES));
  if (detectado?.tipo !== s.tipo) {
    return rechazar(deps, t, s, 'tipo-no-permitido', 'El contenido del archivo no corresponde a un tipo permitido', []);
  }

  const dirTmp = dirTemporal(t, s.id);
  const publicadas: string[] = [];
  const temporales: string[] = [];
  let medio: Medio;
  try {
    const info = await deps.procesador.inspeccionar(s.rutaOriginal, s.tipo);
    if (!Number.isInteger(info.ancho) || !Number.isInteger(info.alto) || info.ancho < 1 || info.alto < 1) {
      return await rechazar(deps, t, s, 'procesamiento', 'No se pudieron leer las dimensiones del archivo', []);
    }
    if (s.tipo === 'foto' && info.ancho * info.alto > LIMITES_CONSOLA.pixelesFotoMax) {
      return await rechazar(deps, t, s, 'limite', 'La imagen tiene demasiados píxeles', []);
    }
    if (s.tipo === 'video') {
      const d = info.duracionSeg;
      if (d === undefined || !Number.isFinite(d) || d <= 0) {
        return await rechazar(deps, t, s, 'procesamiento', 'No se pudo leer la duración del video', []);
      }
      if (d > LIMITES_CONSOLA.duracionVideoSeg) {
        return await rechazar(deps, t, s, 'limite', 'El video dura más de 60 segundos', []);
      }
    }
    const plan = planificarProcesamiento(s.tipo, info.ancho, info.alto);
    const salida = await deps.procesador.procesar({ origen: s.rutaOriginal, tipo: s.tipo, plan, destinoTemporal: dirTmp });
    temporales.push(...salida.map((v) => v.rutaTemporal));
    const falla = validarSalida(plan, salida, dirTmp);
    if (falla !== undefined) return await rechazar(deps, t, s, 'procesamiento', 'No se pudo procesar el archivo', temporales);

    const versiones: VersionMedio[] = [];
    for (const v of salida) {
      const item: ItemPlan = { clase: v.clase, lado: v.lado, formato: v.formato };
      const bytes = await deps.almacen.tamano(v.rutaTemporal);
      if (bytes === undefined || bytes === 0) {
        return await rechazar(deps, t, s, 'procesamiento', 'No se pudo procesar el archivo', [...temporales, ...publicadas]);
      }
      if (v.clase !== 'video') {
        if (bytes > MAX_BYTES_VERSION_IMAGEN) {
          return await rechazar(deps, t, s, 'procesamiento', 'Una versión de la imagen resultó demasiado grande', [...temporales, ...publicadas]);
        }
        if (contieneMetadatos(await deps.almacen.leerInicio(v.rutaTemporal, MAX_BYTES_VERSION_IMAGEN))) {
          return await rechazar(deps, t, s, 'procesamiento', 'La imagen conserva metadatos (EXIF/GPS) y se rechazó', [...temporales, ...publicadas]);
        }
      }
      const destino = rutaPublicaMedio(t, s.productoId, nombreVersion(await deps.almacen.hashContenido(v.rutaTemporal), item));
      await deps.almacen.publicar(v.rutaTemporal, destino);
      publicadas.push(destino);
      versiones.push({ ...item, ruta: destino, bytes });
    }
    medio = {
      id: s.id, productoId: s.productoId, tipo: s.tipo, formatoOriginal: detectado.formato, bytesOriginal: real,
      rutaOriginal: s.rutaOriginal, ancho: info.ancho, alto: info.alto,
      ...(info.duracionSeg === undefined ? {} : { duracionSeg: info.duracionSeg }),
      versiones, creadoEn: deps.reloj.ahora(), por: e.actor.uid,
    };
  } catch (err) {
    if (err instanceof ErrorConsola) throw err; // `rechazar` ya limpió
    return rechazar(deps, t, s, 'procesamiento', 'No se pudo procesar el archivo', [...temporales, ...publicadas]);
  }

  const ahoraIso = new Date(deps.reloj.ahora()).toISOString();
  await deps.db.runTransaction(async (tx) => {
    const actual = leerSubida((await tx.get(rutaSubida(t, s.id))).data());
    const uso = await leerUsoMedios(tx, t);
    const estado = await leerEstadoSitio(tx, t);
    if (actual?.estado !== 'reservada') throw new ErrorConsola('estado', 'La subida ya fue resuelta por otra solicitud');
    // Si el archivo real es más chico que lo reservado, se devuelve la diferencia a la cuota.
    escribirUsoMedios(tx, t, { ...uso, bytes: Math.max(0, uso.bytes - (s.bytes - real)) });
    tx.set(rutaMedio(t, s.id), { ...medio });
    tx.set(rutaSubida(t, s.id), aDoc({ ...actual, estado: 'procesada', bytes: real }));
    anotarCambio(tx, t, estado, ahoraIso);
    registrarAuditoria(tx, {
      tenantId: t, uid: e.actor.uid, rol, accion: 'medio.subir', ruta: rutaMedio(t, s.id),
      resumenDespues: { productoId: s.productoId, tipo: s.tipo, bytes: real },
    });
  });
  await deps.almacen.borrar(temporales).catch(() => undefined); // los temporales no afectan los datos
  return medio;
}

// ---------------------------------------------------------------------------------------------
// Borrado de un medio
// ---------------------------------------------------------------------------------------------

export interface EntradaBorrarMedio {
  readonly tenantId: string;
  readonly actor: Actor;
  readonly medioId: string;
}

async function medioEnUso(tx: TransaccionIdentidad, t: string, medioId: string): Promise<string | undefined> {
  const indice = (await tx.get(rutaSitio(t, 'indice'))).data()?.['secciones'];
  const ids = Array.isArray(indice) ? indice.filter((x): x is string => typeof x === 'string') : [];
  for (const id of ids) {
    const v = validarSeccion((await tx.get(rutaSeccion(t, id))).data());
    if (v.ok && mediosDeSeccion(v.valor).includes(medioId)) return `la sección «${v.valor.titulo}»`;
  }
  for (const p of PLANTILLAS) {
    const items = (await tx.get(rutaCarrusel(t, p))).data()?.['items'];
    if (Array.isArray(items) && items.some((i) => esObjeto(i) && i['medioId'] === medioId)) return `el carrusel de la plantilla ${p}`;
  }
  return undefined;
}

/**
 * Borra un medio: libera la cuota y el contador del producto en la misma transacción, lo quita de la ficha
 * y luego borra los objetos (original y versiones). Si el borrado de objetos falla, la subida queda en
 * `borrando` y `limpiarSubidas` lo reintenta.
 */
export async function borrarMedio(deps: DepsMedios, e: EntradaBorrarMedio): Promise<void> {
  const t = tenantValido(e.tenantId);
  const rol = exigirRol(e.actor, t, ROLES.editarFichas);
  const ahoraIso = new Date(deps.reloj.ahora()).toISOString();
  await deps.db.runTransaction(async (tx) => {
    const m = (await tx.get(rutaMedio(t, e.medioId))).data() as Partial<Medio> | undefined;
    if (m === undefined || typeof m.productoId !== 'string' || (m.tipo !== 'foto' && m.tipo !== 'video')) {
      throw new ErrorConsola('no-encontrado', 'El medio no existe');
    }
    const sub = leerSubida((await tx.get(rutaSubida(t, e.medioId))).data());
    const uso = await leerUsoMedios(tx, t);
    const ficha = (await tx.get(rutaFicha(t, m.productoId))).data();
    const estado = await leerEstadoSitio(tx, t);
    const enUso = await medioEnUso(tx, t, e.medioId);
    if (enUso !== undefined) throw new ErrorConsola('conflicto', `El medio se usa en ${enUso}; quítelo primero`);

    const rutas = [m.rutaOriginal, ...(m.versiones ?? []).map((v) => v.ruta)].filter((r): r is string => typeof r === 'string');
    escribirUsoMedios(tx, t, liberarEnUso(uso, m.productoId, m.tipo, m.bytesOriginal ?? 0));
    tx.delete(rutaMedio(t, e.medioId));
    const base: Subida = sub ?? {
      id: e.medioId, productoId: m.productoId, tipo: m.tipo, bytes: m.bytesOriginal ?? 0, estado: 'procesada',
      rutaOriginal: m.rutaOriginal ?? '', creadaEn: m.creadoEn ?? 0, venceEn: 0, por: e.actor.uid,
    };
    tx.set(rutaSubida(t, e.medioId), aDoc({ ...base, estado: 'borrando', destino: 'eliminar', rutas }));
    if (ficha && Array.isArray(ficha['medios'])) {
      const quedan = (ficha['medios'] as unknown[]).filter((x) => !(esObjeto(x) && x['medioId'] === e.medioId));
      if (quedan.length !== ficha['medios'].length) tx.set(rutaFicha(t, m.productoId), { ...ficha, medios: quedan });
    }
    anotarCambio(tx, t, estado, ahoraIso);
    registrarAuditoria(tx, {
      tenantId: t, uid: e.actor.uid, rol, accion: 'medio.borrar', ruta: rutaMedio(t, e.medioId),
      resumenAntes: { productoId: m.productoId, tipo: m.tipo, bytes: m.bytesOriginal ?? 0 },
    });
  });
  await borrarYCerrar(deps, t, e.medioId);
}

// ---------------------------------------------------------------------------------------------
// Limpieza (tarea programada del servidor, sin actor)
// ---------------------------------------------------------------------------------------------

export interface ResultadoLimpieza {
  readonly vencidas: number;
  readonly reintentadas: number;
}

/**
 * Libera las reservas vencidas (devuelve cuota y contadores, borra lo subido a medias) y reintenta los
 * borrados de objetos que quedaron a medias. Idempotente.
 */
export async function limpiarSubidas(
  deps: DepsMedios & { readonly consulta: ConsultaSubidas },
  tenantId: string,
  limite = 50,
): Promise<ResultadoLimpieza> {
  const t = tenantValido(tenantId);
  const ahora = deps.reloj.ahora();
  let vencidas = 0;
  for (const { id } of await deps.consulta.listarPorEstado(t, 'reservada', limite)) {
    const marcada = await deps.db.runTransaction(async (tx) => {
      const s = leerSubida((await tx.get(rutaSubida(t, id))).data());
      const uso = await leerUsoMedios(tx, t);
      if (s?.estado !== 'reservada' || s.venceEn >= ahora) return false;
      escribirUsoMedios(tx, t, liberarEnUso(uso, s.productoId, s.tipo, s.bytes));
      tx.set(rutaSubida(t, id), aDoc({ ...s, estado: 'borrando', destino: 'vencida', rutas: [s.rutaOriginal] }));
      return true;
    });
    if (marcada) {
      vencidas += 1;
      await borrarYCerrar(deps, t, id);
    }
  }
  let reintentadas = 0;
  for (const { id } of await deps.consulta.listarPorEstado(t, 'borrando', limite)) {
    await borrarYCerrar(deps, t, id);
    reintentadas += 1;
  }
  return { vencidas, reintentadas };
}
