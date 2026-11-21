// Construcción del sitio con un constructor externo (Cloud Build), DR-CB. Una sola construcción a la vez por sitio:
// el bloqueo vive en `tenants/{t}/sitio/construccion` `{buildId, trabajoId, desdeMs, imagen}` (más `ultimaImagen` cuando
// está libre). Aquí solo hay manejadores sobre puertos inyectados (el constructor, el almacén); registrarlos como Cloud
// Functions (`onTaskDispatched`, `onMessagePublished('cloud-builds')`) es del coordinador. Sin `constructorSitio` (modo
// `github`) todo manejador devuelve `sin-constructor` y no hace nada.
import { logger } from 'firebase-functions';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import {
  decidirBloqueo, ejecutarReconstruccion, LIMITES_CONSOLA, type BaseDatosConsola, type ConstructorSitio, type DisparadorSitio,
  type MotivoReconstruccion, type Reloj,
} from '@novutienda/consola';

export interface TrabajoSitio {
  readonly id: string;
  readonly estado: string;
  readonly solicitadaEnMs: number;
  readonly version?: number;
  readonly motivo?: string;
}

export interface BloqueoSitio {
  readonly buildId: string;
  readonly trabajoId: string;
  readonly desdeMs: number;
  readonly imagen: string;
}

/** Documento `sitio/construccion`: el bloqueo (si hay) y la imagen de la última construcción exitosa. */
export interface EstadoConstruccion {
  readonly bloqueo: BloqueoSitio | null;
  readonly ultimaImagen?: string;
}

/** Operaciones dentro de una transacción por sitio: todas las lecturas van antes de las escrituras. */
export interface TxConstruccion {
  estado(): Promise<EstadoConstruccion>;
  /** Trabajos `pendiente`, el más antiguo primero. */
  pendientes(): Promise<readonly TrabajoSitio[]>;
  trabajo(id: string): Promise<TrabajoSitio | undefined>;
  fijarBloqueo(bloqueo: BloqueoSitio, ultimaImagen: string | undefined): void;
  /** Libera el bloqueo y deja `ultimaImagen`. */
  liberar(ultimaImagen: string | undefined): void;
  marcar(id: string, estado: 'completada' | 'fallida', ahora: number): void;
}

export interface AlmacenConstruccion {
  transaccion<T>(tenantId: string, fn: (tx: TxConstruccion) => Promise<T>): Promise<T>;
  /** Trabajos `pendiente` o `en_curso` (para la alerta). */
  abiertos(tenantId: string): Promise<readonly TrabajoSitio[]>;
  /** Crea el trabajo `pendiente` si no existe (id idempotente). */
  crearPendiente(tenantId: string, id: string, datos: { version: number; motivo: MotivoReconstruccion; solicitadaEnMs: number }): Promise<void>;
  leerUltimaImagen(tenantId: string): Promise<string | undefined>;
  /** Versión de lo publicado, o undefined si el tenant no publicó nada. */
  versionPublicada(tenantId: string): Promise<number | undefined>;
}

export interface DepsConstruccion {
  readonly almacen: AlmacenConstruccion;
  readonly reloj: Reloj;
  /** Ausente = modo `github`: sin efecto. */
  readonly constructorSitio?: ConstructorSitio;
  /** Imagen del constructor vigente (`CONSTRUCTOR_SITIO_IMAGEN`); si cambia respecto de `ultimaImagen` se reconstruye por `codigo`. */
  readonly imagenActual?: string;
  /** Alerta de trabajo atrasado; por defecto un registro `error` con `alerta: "sitio"`. */
  readonly alertar?: (info: { tenantId: string; trabajoId: string; minutos: number }) => void;
}

export type ResultadoLanzamiento = 'sin-constructor' | 'nada' | 'lanzado' | 'esperar' | 'relanzado';

const RUTA_CONSTRUCCION = (t: string): string => `tenants/${t}/sitio/construccion`;
const COL_TRABAJOS = (t: string): string => `tenants/${t}/reconstrucciones`;
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Lanza el trabajo pendiente más antiguo si el sitio está libre (o su bloqueo venció). Un pendiente con construcción en curso espera. */
export async function lanzarSiguiente(deps: DepsConstruccion, tenantId: string): Promise<ResultadoLanzamiento> {
  const constructor = deps.constructorSitio;
  if (constructor === undefined) return 'sin-constructor';
  const ahora = deps.reloj.ahora();
  const r = await deps.almacen.transaccion(tenantId, async (tx) => {
    const { bloqueo, ultimaImagen } = await tx.estado();
    const pendientes = await tx.pendientes();
    const decision = decidirBloqueo(bloqueo, ahora);
    if (decision === 'esperar') return { resultado: 'esperar' as const };
    const muerto = decision === 'relanzar' && bloqueo !== null ? await tx.trabajo(bloqueo.trabajoId) : undefined;
    const siguiente = pendientes[0];
    if (muerto !== undefined && (muerto.estado === 'en_curso' || muerto.estado === 'pendiente') && siguiente?.id !== muerto.id) {
      tx.marcar(muerto.id, 'fallida', ahora);
    }
    if (siguiente === undefined) {
      if (decision === 'relanzar') tx.liberar(ultimaImagen);
      return { resultado: 'nada' as const };
    }
    tx.fijarBloqueo({ buildId: '', trabajoId: siguiente.id, desdeMs: ahora, imagen: deps.imagenActual ?? '' }, ultimaImagen);
    return { resultado: decision === 'relanzar' ? ('relanzado' as const) : ('lanzado' as const), trabajoId: siguiente.id };
  });
  if (r.resultado !== 'lanzado' && r.resultado !== 'relanzado') return r.resultado;
  try {
    const { buildId, imagen } = await constructor.lanzar(tenantId, r.trabajoId);
    await deps.almacen.transaccion(tenantId, async (tx) => {
      const { bloqueo, ultimaImagen } = await tx.estado();
      if (bloqueo?.trabajoId === r.trabajoId && bloqueo.desdeMs === ahora) tx.fijarBloqueo({ ...bloqueo, buildId, imagen }, ultimaImagen);
    });
  } catch (error) {
    // No quedó construcción: se libera el bloqueo (el trabajo sigue `pendiente`) y el error sube para que la cola reintente.
    await deps.almacen.transaccion(tenantId, async (tx) => {
      const { bloqueo, ultimaImagen } = await tx.estado();
      if (bloqueo?.trabajoId === r.trabajoId && bloqueo.desdeMs === ahora) tx.liberar(ultimaImagen);
    });
    throw error;
  }
  return r.resultado;
}

export interface DepsTareaConstruccion extends DepsConstruccion {
  readonly db: BaseDatosConsola;
  readonly disparador: DisparadorSitio;
}

/** Manejador de la tarea de Cloud Tasks agendada por `programar`: crea el trabajo `pendiente` y lo lanza si el sitio está libre. */
export async function manejarTareaConstruccion(
  deps: DepsTareaConstruccion, tarea: { readonly tenantId: string; readonly para: number },
): Promise<ResultadoLanzamiento | 'temprana'> {
  if (deps.constructorSitio === undefined) return 'sin-constructor';
  const dec = await ejecutarReconstruccion({ db: deps.db, reloj: deps.reloj, disparador: deps.disparador }, { tenantId: tarea.tenantId, evento: 'tarea' });
  // Más de la tolerancia antes de la hora: no se hace nada; el temporizador de 5 min es la red.
  if (dec.accion === 'esperar') return 'temprana';
  return lanzarSiguiente(deps, tarea.tenantId);
}

export type EstadoBuild = 'SUCCESS' | 'FAILURE' | 'TIMEOUT' | 'INTERNAL_ERROR' | 'CANCELLED' | 'EXPIRED' | (string & {});

const TERMINALES: ReadonlySet<string> = new Set(['SUCCESS', 'FAILURE', 'TIMEOUT', 'INTERNAL_ERROR', 'CANCELLED', 'EXPIRED']);
const REINTENTABLES: ReadonlySet<string> = new Set(['TIMEOUT', 'INTERNAL_ERROR', 'EXPIRED']);

/**
 * Manejador del aviso `cloud-builds`. El coordinador resuelve el `tenantId` (etiqueta `sitio-<clave>`) y entrega el estado
 * del build. Estados no terminales y avisos de un build que ya no es el bloqueado (duplicados, viejos) se ignoran.
 *  - SUCCESS: completa los pendientes con `solicitadaEnMs` anterior al inicio de la construcción (el build compiló lo publicado
 *    vigente); libera el bloqueo y guarda `ultimaImagen`.
 *  - Falla: el trabajo de la construcción pasa a `fallida` (si seguía `pendiente` o `en_curso`); ante TIMEOUT, INTERNAL_ERROR o EXPIRED (D7: no arrancó dentro de queueTtl) se
 *    registra la alerta `sitio` y se encola UN reintento (`rec-reintento-<trabajo>`, motivo `reintento`; un reintento que falla no se repite). Libera el bloqueo.
 *  - Después lanza el siguiente pendiente.
 */
export async function manejarAvisoConstruccion(
  deps: DepsConstruccion, aviso: { readonly tenantId: string; readonly buildId: string; readonly estado: EstadoBuild },
): Promise<'ignorado' | 'completado' | 'fallido' | 'sin-constructor'> {
  if (deps.constructorSitio === undefined) return 'sin-constructor';
  if (!TERMINALES.has(aviso.estado)) return 'ignorado';
  const ahora = deps.reloj.ahora();
  const t = aviso.tenantId;
  const r = await deps.almacen.transaccion(t, async (tx) => {
    const { bloqueo, ultimaImagen } = await tx.estado();
    if (bloqueo === null || bloqueo.buildId !== aviso.buildId) return { resultado: 'ignorado' as const };
    const propio = await tx.trabajo(bloqueo.trabajoId);
    if (aviso.estado === 'SUCCESS') {
      const pendientes = await tx.pendientes();
      for (const p of pendientes) if (p.solicitadaEnMs < bloqueo.desdeMs) tx.marcar(p.id, 'completada', ahora);
      if (propio !== undefined && propio.estado === 'en_curso') tx.marcar(propio.id, 'completada', ahora);
      tx.liberar(bloqueo.imagen === '' ? ultimaImagen : bloqueo.imagen);
      return { resultado: 'completado' as const };
    }
    if (propio !== undefined && (propio.estado === 'en_curso' || propio.estado === 'pendiente')) tx.marcar(propio.id, 'fallida', ahora);
    tx.liberar(ultimaImagen);
    const reintentar = REINTENTABLES.has(aviso.estado) && propio !== undefined && propio.motivo !== 'reintento';
    return { resultado: 'fallido' as const, reintentar, propio };
  });
  if (r.resultado === 'fallido' && aviso.estado === 'EXPIRED' && r.propio !== undefined) {
    (deps.alertar ?? alertaPorDefecto)({ tenantId: t, trabajoId: r.propio.id, minutos: Math.floor((ahora - r.propio.solicitadaEnMs) / 60_000) });
  }
  if (r.resultado === 'ignorado') return 'ignorado';
  if (r.resultado === 'fallido' && r.reintentar && r.propio !== undefined) {
    await deps.almacen.crearPendiente(t, `rec-reintento-${r.propio.id}`, {
      version: r.propio.version ?? 0, motivo: 'reintento', solicitadaEnMs: ahora,
    });
  }
  await lanzarSiguiente(deps, t);
  return r.resultado;
}

const alertaPorDefecto = (i: { tenantId: string; trabajoId: string; minutos: number }): void => {
  logger.error('reconstrucción del sitio atrasada', { alerta: 'sitio', tenantId: i.tenantId, trabajoId: i.trabajoId, minutos: i.minutos });
};

const etiquetaImagen = (imagen: string): string => imagen.replace(/^.*[:@]/, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 16);

/**
 * Red de seguridad del temporizador (cada 5 minutos), por tenant: (1) alerta de todo trabajo abierto de más de 10 minutos;
 * (2) si la imagen del constructor cambió respecto de `ultimaImagen`, encola una reconstrucción con motivo `codigo`;
 * (3) relanza un pendiente sin construcción o con el bloqueo vencido (más de 12 minutos).
 */
export async function redConstruccion(deps: DepsConstruccion, tenantId: string): Promise<ResultadoLanzamiento> {
  if (deps.constructorSitio === undefined) return 'sin-constructor';
  const ahora = deps.reloj.ahora();
  const alertar = deps.alertar ?? alertaPorDefecto;
  for (const j of await deps.almacen.abiertos(tenantId)) {
    if (ahora - j.solicitadaEnMs > LIMITES_CONSOLA.alertaTrabajoMs) alertar({ tenantId, trabajoId: j.id, minutos: Math.floor((ahora - j.solicitadaEnMs) / 60_000) });
  }
  const imagen = deps.imagenActual;
  if (imagen !== undefined && imagen !== '') {
    const ultima = await deps.almacen.leerUltimaImagen(tenantId);
    if (ultima !== undefined && ultima !== '' && ultima !== imagen) {
      const version = await deps.almacen.versionPublicada(tenantId);
      if (version !== undefined) await deps.almacen.crearPendiente(tenantId, `rec-codigo-${etiquetaImagen(imagen)}`, { version, motivo: 'codigo', solicitadaEnMs: ahora });
    }
  }
  return lanzarSiguiente(deps, tenantId);
}

// ---------------------------------------------------------------------------------------------
// Almacén sobre Firestore (Admin)
// ---------------------------------------------------------------------------------------------

function aTrabajo(id: string, d: Readonly<Record<string, unknown>>): TrabajoSitio {
  const version = num(d['version']);
  return {
    id, estado: typeof d['estado'] === 'string' ? d['estado'] : '', solicitadaEnMs: num(d['solicitadaEnMs']) ?? 0,
    ...(version === undefined ? {} : { version }), ...(typeof d['motivo'] === 'string' ? { motivo: d['motivo'] } : {}),
  };
}

function aEstado(d: Readonly<Record<string, unknown>> | undefined): EstadoConstruccion {
  const ultimaImagen = typeof d?.['ultimaImagen'] === 'string' ? d['ultimaImagen'] : undefined;
  const base = ultimaImagen === undefined ? {} : { ultimaImagen };
  const trabajoId = d?.['trabajoId'];
  const desdeMs = num(d?.['desdeMs']);
  if (typeof trabajoId !== 'string' || desdeMs === undefined) return { bloqueo: null, ...base };
  return {
    bloqueo: { buildId: typeof d?.['buildId'] === 'string' ? d['buildId'] : '', trabajoId, desdeMs, imagen: typeof d?.['imagen'] === 'string' ? d['imagen'] : '' },
    ...base,
  };
}

const YA_EXISTE = 6;

export function almacenConstruccionFirestore(firestore: Firestore): AlmacenConstruccion {
  const txDe = (t: string, tx: Transaction): TxConstruccion => {
    const rutaB = firestore.doc(RUTA_CONSTRUCCION(t));
    return {
      estado: async () => aEstado((await tx.get(rutaB)).data()),
      pendientes: async () => {
        const s = await tx.get(firestore.collection(COL_TRABAJOS(t)).where('estado', '==', 'pendiente').limit(50));
        return s.docs.map((x) => aTrabajo(x.id, x.data())).sort((a, b) => a.solicitadaEnMs - b.solicitadaEnMs);
      },
      trabajo: async (id) => {
        const d = await tx.get(firestore.doc(`${COL_TRABAJOS(t)}/${id}`));
        return d.exists ? aTrabajo(id, d.data() ?? {}) : undefined;
      },
      fijarBloqueo: (b, ultimaImagen) => {
        tx.set(rutaB, { ...b, ...(ultimaImagen === undefined ? {} : { ultimaImagen }) });
      },
      liberar: (ultimaImagen) => {
        tx.set(rutaB, ultimaImagen === undefined ? {} : { ultimaImagen });
      },
      marcar: (id, estado, ahora) => {
        tx.update(firestore.doc(`${COL_TRABAJOS(t)}/${id}`), { estado, cerradaEnMs: ahora });
      },
    };
  };
  return {
    transaccion: (t, fn) => firestore.runTransaction((tx) => fn(txDe(t, tx))),
    abiertos: async (t) => {
      const [p, c] = await Promise.all(['pendiente', 'en_curso'].map((e) => firestore.collection(COL_TRABAJOS(t)).where('estado', '==', e).limit(50).get()));
      return [...(p?.docs ?? []), ...(c?.docs ?? [])].map((x) => aTrabajo(x.id, x.data()));
    },
    crearPendiente: async (t, id, datos) => {
      try {
        await firestore.doc(`${COL_TRABAJOS(t)}/${id}`).create({ estado: 'pendiente', ...datos });
      } catch (error) {
        if ((error as { code?: unknown }).code !== YA_EXISTE) throw error;
      }
    },
    leerUltimaImagen: async (t) => aEstado((await firestore.doc(RUTA_CONSTRUCCION(t)).get()).data()).ultimaImagen,
    versionPublicada: async (t) => num((await firestore.doc(`tenants/${t}/publicado/estado`).get()).data()?.['version']),
  };
}
