import { registrarAuditoria, type Actor, type TransaccionIdentidad } from '@novutienda/nucleo';
import { anotarCambio, leerEstadoSitio } from '../cambios.js';
import { ArchivoNoAdmitido, ErrorConsola, ProcesamientoNoDisponible, type CodigoErrorConsola } from '../errores.js';
import { LIMITES_CONSOLA } from '../limites.js';
import { exigirRol, ROLES } from '../permisos.js';
import { PLANTILLAS } from '../plantillas.js';
import type { AlmacenMedios, BaseDatosConsola, CatalogoPuerto, ConsultaSubidas, ProcesadorMedios, Reloj } from '../puertos.js';
import {
  dirTemporal, ID_PRODUCTO, ID_SUBIDA, prefijoTemporal, rutaCarrusel, rutaFicha, rutaMedio, rutaOriginal, rutaPublicaMedio, rutaSeccion, rutaSitio,
  rutaSubida, tenantValido,
} from '../rutas.js';
import { mediosDeSeccion, validarSeccion } from '../secciones.js';
import { esObjeto } from '../validar.js';
import { contieneMetadatos } from './metadatos.js';
import { nombreVersion, planificarProcesamiento, type ItemPlan, type PlanProcesamiento } from './plan.js';
import { BYTES_INICIALES, detectarArchivo, type FormatoArchivo, type TipoMedio } from './tipos-archivo.js';
import { escribirUsoMedios, leerUsoMedios, liberarEnUso, reservarEnUso } from './uso.js';

/** Texto para el usuario cuando el procesamiento de video no está disponible (el archivo no tiene la culpa). */
export const MENSAJE_VIDEO_NO_DISPONIBLE = 'El procesamiento de video no está disponible por ahora; su archivo no tiene problemas. Intente más tarde.';

export interface DepsMedios {
  readonly db: BaseDatosConsola;
  readonly almacen: AlmacenMedios;
  readonly procesador: ProcesadorMedios;
  readonly catalogo: CatalogoPuerto;
  readonly reloj: Reloj;
  /** Generador del identificador de invocación (solo para pruebas; por defecto aleatorio). */
  readonly nuevoId?: () => string;
}

/** Tope de una versión procesada de imagen que se lee completa para buscar metadatos. */
const MAX_BYTES_VERSION_IMAGEN = 8 * 1024 * 1024;

type EstadoSubida = 'reservada' | 'procesando' | 'procesada' | 'borrando' | 'rechazada';
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
  /** Solo con `procesando`: identificador de la invocación que reclamó la subida y cuándo vence ese reclamo. */
  readonly procesandoPor?: string;
  readonly procesandoVenceEn?: number;
}

function leerSubida(d: Readonly<Record<string, unknown>> | undefined): Subida | undefined {
  if (d === undefined) return undefined;
  const { id, productoId, tipo, bytes, estado, creadaEn, venceEn, por } = d;
  if (
    typeof id !== 'string' || typeof productoId !== 'string' || (tipo !== 'foto' && tipo !== 'video') ||
    typeof bytes !== 'number' || typeof creadaEn !== 'number' || typeof venceEn !== 'number' || typeof por !== 'string' ||
    typeof d['rutaOriginal'] !== 'string' ||
    (estado !== 'reservada' && estado !== 'procesando' && estado !== 'procesada' && estado !== 'borrando' && estado !== 'rechazada')
  ) {
    throw new ErrorConsola('estado', 'Registro de subida dañado');
  }
  const destino = d['destino'];
  const rutas = d['rutas'];
  const motivo = d['motivo'];
  const pPor = d['procesandoPor'];
  const pVence = d['procesandoVenceEn'];
  return {
    id, productoId, tipo, bytes, estado, creadaEn, venceEn, por, rutaOriginal: d['rutaOriginal'],
    ...(destino === 'eliminar' || destino === 'rechazada' || destino === 'vencida' ? { destino } : {}),
    ...(typeof motivo === 'string' ? { motivo } : {}),
    ...(typeof pPor === 'string' ? { procesandoPor: pPor } : {}),
    ...(typeof pVence === 'number' ? { procesandoVenceEn: pVence } : {}),
    ...(Array.isArray(rutas) ? { rutas: rutas.filter((r): r is string => typeof r === 'string') } : {}),
  };
}

/**
 * Campos de la reserva que la regla de Storage (`reservaValida`, generada desde el manifiesto) lee del documento de `subidas`.
 * Contrato con `scripts/generar-reglas.mjs`: lo fija `pruebas/consola/contrato-reserva.test.ts`.
 */
export const CAMPOS_RESERVA = ['estado', 'venceEn', 'productoId', 'por', 'bytes', 'tipo'] as const;
export type CampoReserva = (typeof CAMPOS_RESERVA)[number];

const aDoc = (s: Subida): Record<string, unknown> => ({ ...s });

/** Quita las marcas del reclamo (al volver a `reservada` o pasar a un estado final). */
function sinReclamo(s: Subida): Subida {
  const { procesandoPor: _p, procesandoVenceEn: _v, ...resto } = s;
  void _p;
  void _v;
  return resto;
}

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
  if (e.tipo === 'video' && (await deps.procesador.disponible?.('video')) === false) {
    throw new ErrorConsola('no-disponible', MENSAJE_VIDEO_NO_DISPONIBLE);
  }
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
    const campos: Pick<Subida, CampoReserva> = {
      estado: 'reservada', venceEn, productoId: e.productoId, por: e.actor.uid, bytes: e.bytes, tipo: e.tipo,
    };
    const s: Subida = { id: e.subidaId, rutaOriginal: ruta, creadaEn: ahora, ...campos };
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
  deps: DepsMedios, t: string, s: Subida, reclamo: string, codigo: CodigoErrorConsola, motivo: string, extras: readonly string[],
): Promise<never> {
  const rutas = [s.rutaOriginal, ...extras];
  const propia = await deps.db.runTransaction(async (tx) => {
    const actual = leerSubida((await tx.get(rutaSubida(t, s.id))).data());
    const uso = await leerUsoMedios(tx, t);
    // Solo actúa quien tiene el reclamo vigente de esta subida; si no, otra invocación la resolvió y no se toca nada.
    if (actual?.estado !== 'procesando' || actual.procesandoPor !== reclamo) return false;
    escribirUsoMedios(tx, t, liberarEnUso(uso, s.productoId, s.tipo, s.bytes));
    tx.set(rutaSubida(t, s.id), aDoc({ ...sinReclamo(actual), estado: 'borrando', destino: 'rechazada', motivo, rutas }));
    return true;
  });
  if (propia) await borrarYCerrar(deps, t, s.id);
  else {
    // No es la dueña: no toca el original ni lo publicado, solo los temporales de su propia carpeta de invocación.
    const propios = extras.filter((r) => r.startsWith(`${dirTemporal(t, s.id, reclamo)}/`));
    if (propios.length > 0) await deps.almacen.borrar(propios).catch(() => undefined);
    await deps.almacen.borrarPrefijo?.(`${dirTemporal(t, s.id, reclamo)}/`).catch(() => undefined); // lo que el procesador dejó sin informar
  }
  throw new ErrorConsola(codigo, motivo);
}

/** Borra los objetos de una subida en estado `borrando` y la cierra (`rechazada`) o la elimina. */
async function borrarYCerrar(deps: DepsMedios, t: string, subidaId: string): Promise<void> {
  const s = leerSubida((await leerDoc(deps.db, rutaSubida(t, subidaId))));
  if (s?.estado !== 'borrando') return;
  await deps.almacen.borrar(s.rutas ?? [s.rutaOriginal]);
  await deps.almacen.borrarPrefijo?.(prefijoTemporal(t, subidaId)); // restos de invocaciones que murieron a medias
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

/** Devuelve la subida a `reservada` si todavía la tiene reclamada esta invocación (error previo al procesamiento). */
async function soltarReclamo(deps: DepsMedios, t: string, subidaId: string, reclamo: string): Promise<void> {
  await deps.db.runTransaction(async (tx) => {
    const actual = leerSubida((await tx.get(rutaSubida(t, subidaId))).data());
    if (actual?.estado !== 'procesando' || actual.procesandoPor !== reclamo) return;
    tx.set(rutaSubida(t, subidaId), aDoc({ ...sinReclamo(actual), estado: 'reservada' }));
  });
}

/** Identificador de invocación: solo debe ser único (no es un secreto). */
const idAleatorio = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`;

/**
 * Reclama la subida para esta invocación (`reservada` -> `procesando` con vencimiento). Si ya está `procesada` devuelve su
 * medio; si otra invocación la tiene vigente responde «en curso» (error `estado`, sin tocar nada); un reclamo vencido
 * (el proceso murió) se retoma.
 */
async function reclamar(
  deps: DepsMedios, t: string, subidaId: string, reclamo: string,
): Promise<{ readonly subida: Subida } | { readonly medio: Medio }> {
  return deps.db.runTransaction(async (tx) => {
    const actual = leerSubida((await tx.get(rutaSubida(t, subidaId))).data());
    if (actual === undefined) throw new ErrorConsola('no-encontrado', 'La subida no existe');
    const ahora = deps.reloj.ahora();
    if (actual.estado === 'procesada') {
      const m = (await tx.get(rutaMedio(t, subidaId))).data();
      if (m !== undefined) return { medio: m as unknown as Medio };
    }
    if (actual.estado === 'procesando' && actual.procesandoPor === reclamo) return { subida: actual }; // reintento de la propia invocación
    if (actual.estado === 'procesando' && (actual.procesandoVenceEn ?? 0) > ahora) {
      throw new ErrorConsola('estado', 'La subida se está procesando; vuelva a consultar en unos segundos');
    }
    if (actual.estado !== 'reservada' && actual.estado !== 'procesando') throw new ErrorConsola('estado', 'La subida ya no está pendiente');
    if (ahora > actual.venceEn) throw new ErrorConsola('estado', 'La reserva de subida venció; reserve de nuevo');
    const subida: Subida = {
      ...actual, estado: 'procesando', procesandoPor: reclamo, procesandoVenceEn: ahora + LIMITES_CONSOLA.vencimientoProcesandoMs,
    };
    tx.set(rutaSubida(t, subidaId), aDoc(subida));
    return { subida };
  });
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
  // Exclusión mutua: el disparador de Storage y la acción explícita pueden finalizar la MISMA subida a la vez. Solo gana
  // quien pasa la subida de `reservada` a `procesando` en una transacción; el resto no procesa ni rechaza nada.
  const reclamo = (deps.nuevoId ?? idAleatorio)();
  const r = await reclamar(deps, t, e.subidaId, reclamo);
  if ('medio' in r) return r.medio;
  try {
    return await procesarReclamada(deps, t, e, rol, reclamo, r.subida);
  } catch (err) {
    // Cualquier salida con error devuelve la subida a `reservada` si esta invocación aún la tiene (si `rechazar` o el ganador ya la
    // resolvieron, el token no coincide y no hace nada). Así un fallo transitorio no la deja bloqueada hasta el vencimiento.
    await soltarReclamo(deps, t, e.subidaId, reclamo).catch(() => undefined);
    throw err;
  }
}

async function procesarReclamada(
  deps: DepsMedios, t: string, e: EntradaFinalizar, rol: ReturnType<typeof exigirRol>, reclamo: string, s: Subida,
): Promise<Medio> {
  const tope = s.tipo === 'foto' ? LIMITES_CONSOLA.bytesFoto : LIMITES_CONSOLA.bytesVideo;
  const real = await deps.almacen.tamano(s.rutaOriginal);
  if (real === undefined) throw new ErrorConsola('no-encontrado', 'El archivo todavía no llegó');
  if (real === 0) return rechazar(deps, t, s, reclamo, 'entrada-invalida', 'El archivo está vacío', []);
  if (real > s.bytes || real > tope) {
    return rechazar(deps, t, s, reclamo, 'limite', s.tipo === 'foto' ? 'La foto supera 15 MB' : 'El video supera 200 MB', []);
  }

  const detectado = detectarArchivo(await deps.almacen.leerInicio(s.rutaOriginal, BYTES_INICIALES));
  if (detectado?.tipo !== s.tipo) {
    return rechazar(deps, t, s, reclamo, 'tipo-no-permitido', 'El contenido del archivo no corresponde a un tipo permitido', []);
  }

  const dirTmp = dirTemporal(t, s.id, reclamo);
  const publicadas: string[] = [];
  const temporales: string[] = [];
  let medio: Medio;
  try {
    const info = await deps.procesador.inspeccionar(s.rutaOriginal, s.tipo);
    if (!Number.isInteger(info.ancho) || !Number.isInteger(info.alto) || info.ancho < 1 || info.alto < 1) {
      return await rechazar(deps, t, s, reclamo, 'procesamiento', 'No se pudieron leer las dimensiones del archivo', []);
    }
    if (s.tipo === 'foto' && info.ancho * info.alto > LIMITES_CONSOLA.pixelesFotoMax) {
      return await rechazar(deps, t, s, reclamo, 'limite', 'La imagen tiene demasiados píxeles', []);
    }
    if (s.tipo === 'video') {
      const { ladoVideoMax, pixelesVideoMax } = LIMITES_CONSOLA;
      if (Math.max(info.ancho, info.alto) > ladoVideoMax || info.ancho * info.alto > pixelesVideoMax) {
        return await rechazar(deps, t, s, reclamo, 'limite', `El video mide ${info.ancho}×${info.alto} y el máximo es ${ladoVideoMax}×${pixelesVideoMax / ladoVideoMax}`, []);
      }
      const d = info.duracionSeg;
      if (d === undefined || !Number.isFinite(d) || d <= 0) {
        return await rechazar(deps, t, s, reclamo, 'procesamiento', 'No se pudo leer la duración del video', []);
      }
      if (d > LIMITES_CONSOLA.duracionVideoSeg) {
        return await rechazar(deps, t, s, reclamo, 'limite', 'El video dura más de 60 segundos', []);
      }
    }
    const plan = planificarProcesamiento(s.tipo, info.ancho, info.alto);
    const salida = await deps.procesador.procesar({ origen: s.rutaOriginal, tipo: s.tipo, plan, destinoTemporal: dirTmp });
    temporales.push(...salida.map((v) => v.rutaTemporal));
    const falla = validarSalida(plan, salida, dirTmp);
    if (falla !== undefined) return await rechazar(deps, t, s, reclamo, 'procesamiento', 'No se pudo procesar el archivo', temporales);

    const versiones: VersionMedio[] = [];
    for (const v of salida) {
      const item: ItemPlan = { clase: v.clase, lado: v.lado, formato: v.formato };
      const bytes = await deps.almacen.tamano(v.rutaTemporal);
      if (bytes === undefined || bytes === 0) {
        return await rechazar(deps, t, s, reclamo, 'procesamiento', 'No se pudo procesar el archivo', [...temporales, ...publicadas]);
      }
      if (v.clase !== 'video') {
        if (bytes > MAX_BYTES_VERSION_IMAGEN) {
          return await rechazar(deps, t, s, reclamo, 'procesamiento', 'Una versión de la imagen resultó demasiado grande', [...temporales, ...publicadas]);
        }
        if (contieneMetadatos(await deps.almacen.leerInicio(v.rutaTemporal, MAX_BYTES_VERSION_IMAGEN))) {
          return await rechazar(deps, t, s, reclamo, 'procesamiento', 'La imagen conserva metadatos (EXIF/GPS) y se rechazó', [...temporales, ...publicadas]);
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
    if (err instanceof ProcesamientoNoDisponible) {
      return rechazar(deps, t, s, reclamo, 'no-disponible', MENSAJE_VIDEO_NO_DISPONIBLE, [...temporales, ...publicadas]);
    }
    if (err instanceof ArchivoNoAdmitido) {
      return rechazar(deps, t, s, reclamo, 'tipo-no-permitido', err.message, [...temporales, ...publicadas]);
    }
    return rechazar(deps, t, s, reclamo, 'procesamiento', 'No se pudo procesar el archivo', [...temporales, ...publicadas]);
  }

  const ahoraIso = new Date(deps.reloj.ahora()).toISOString();
  try {
    await deps.db.runTransaction(async (tx) => {
      const actual = leerSubida((await tx.get(rutaSubida(t, s.id))).data());
      const uso = await leerUsoMedios(tx, t);
      const estado = await leerEstadoSitio(tx, t);
      if (actual?.estado !== 'procesando' || actual.procesandoPor !== reclamo) {
        throw new ErrorConsola('estado', 'La subida ya fue resuelta por otra solicitud');
      }
      // Si el archivo real es más chico que lo reservado, se devuelve la diferencia a la cuota.
      escribirUsoMedios(tx, t, { ...uso, bytes: Math.max(0, uso.bytes - (s.bytes - real)) });
      tx.set(rutaMedio(t, s.id), { ...medio });
      tx.set(rutaSubida(t, s.id), aDoc({ ...sinReclamo(actual), estado: 'procesada', bytes: real }));
      anotarCambio(tx, t, estado, ahoraIso);
      registrarAuditoria(tx, {
        tenantId: t, uid: e.actor.uid, rol, accion: 'medio.subir', ruta: rutaMedio(t, s.id),
        resumenDespues: { productoId: s.productoId, tipo: s.tipo, bytes: real },
      });
    });
  } catch (err) {
    // Otra ejecución (el disparador de Storage o la acción explícita) ganó la carrera: se limpian los temporales de esta
    // y las versiones publicadas que el ganador no usa (con contenido igual comparten ruta y no se tocan). Si el ganador
    // dejó el medio listo, esta llamada lo devuelve (es idempotente); si no, sube el error.
    if (!(err instanceof ErrorConsola) || err.codigo !== 'estado') throw err;
    const ganador = await leerDoc(deps.db, rutaMedio(t, s.id));
    const delGanador = new Set(((ganador as Partial<Medio> | undefined)?.versiones ?? []).map((v) => v.ruta));
    // Sin ganador confirmado NO se borra lo publicado: puede ser el contenido (misma ruta por hash) que otra invocación retomada
    // está por confirmar. Las versiones huérfanas solo se limpian cuando el ganador ya dejó su medio.
    const aBorrar = ganador === undefined ? temporales : [...temporales, ...publicadas.filter((r) => !delGanador.has(r))];
    await deps.almacen.borrar(aBorrar).catch(() => undefined);
    if (ganador !== undefined) return ganador as unknown as Medio;
    throw err;
  }
  await deps.almacen.borrar(temporales).catch(() => undefined); // los temporales no afectan los datos
  return medio;
}

// ---------------------------------------------------------------------------------------------
// Estado de una subida (consulta sin efectos: el panel espera al disparador de Storage con ella)
// ---------------------------------------------------------------------------------------------

export interface EntradaEstadoSubida {
  readonly tenantId: string;
  readonly actor: Actor;
  readonly subidaId: string;
}

export interface EstadoDeSubida {
  readonly estado: EstadoSubida;
  /** Solo con `procesada`. */
  readonly medio?: Medio;
  /** Solo con `rechazada` (o `borrando` por rechazo): el motivo apto para el usuario. */
  readonly motivo?: string;
}

/**
 * Consulta el estado de una subida SIN procesar nada: evita que el panel y el disparador procesen el mismo original
 * dos veces. `reservada` significa que falta procesar (o que el archivo aún no llegó).
 */
export async function estadoSubida(deps: DepsMedios, e: EntradaEstadoSubida): Promise<EstadoDeSubida> {
  const t = tenantValido(e.tenantId);
  exigirRol(e.actor, t, ROLES.editarFichas);
  if (!ID_SUBIDA.test(e.subidaId)) throw new ErrorConsola('entrada-invalida', 'subidaId inválido');
  const s = leerSubida(await leerDoc(deps.db, rutaSubida(t, e.subidaId)));
  if (s === undefined) throw new ErrorConsola('no-encontrado', 'La subida no existe');
  if (s.estado === 'procesada') {
    const m = await leerDoc(deps.db, rutaMedio(t, s.id));
    return m === undefined ? { estado: 'reservada' } : { estado: 'procesada', medio: m as unknown as Medio };
  }
  // `procesando` es interno: para el panel sigue siendo «falta procesar».
  return { estado: s.estado === 'procesando' ? 'reservada' : s.estado, ...(s.motivo === undefined ? {} : { motivo: s.motivo }) };
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
  // `procesando` vencida: el proceso que la reclamó murió. Con reserva vigente vuelve a `reservada` (se puede finalizar de
  // nuevo); con reserva vencida se libera como cualquier otra.
  for (const { id } of await deps.consulta.listarPorEstado(t, 'procesando', limite)) {
    const marcada = await deps.db.runTransaction(async (tx) => {
      const s = leerSubida((await tx.get(rutaSubida(t, id))).data());
      const uso = await leerUsoMedios(tx, t);
      if (s?.estado !== 'procesando' || (s.procesandoVenceEn ?? 0) >= ahora) return false;
      if (s.venceEn >= ahora) {
        tx.set(rutaSubida(t, id), aDoc({ ...sinReclamo(s), estado: 'reservada' }));
        return false;
      }
      escribirUsoMedios(tx, t, liberarEnUso(uso, s.productoId, s.tipo, s.bytes));
      tx.set(rutaSubida(t, id), aDoc({ ...sinReclamo(s), estado: 'borrando', destino: 'vencida', rutas: [s.rutaOriginal] }));
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
