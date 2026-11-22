// Construcción del sitio con un constructor externo (Cloud Build), DR-CB. Una sola construcción a la vez por sitio:
// el bloqueo vive en `tenants/{t}/sitio/construccion` `{buildId, trabajoId, desdeMs, imagen}` (más `ultimaImagen` cuando
// está libre). Aquí solo hay manejadores sobre puertos inyectados (el constructor, el almacén); registrarlos como Cloud
// Functions (`onTaskDispatched`, `onMessagePublished('cloud-builds')`) es del coordinador. Sin `constructorSitio` (modo
// `github`) todo manejador devuelve `sin-constructor` y no hace nada.
import { logger } from 'firebase-functions';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import {
  decidirBloqueo, diaLaPaz, ejecutarReconstruccion, LIMITES_CONSOLA, type BaseDatosConsola, type ConstructorSitio, type DisparadorSitio,
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
  /** Construcciones lanzadas en el día (La Paz) del sitio, para el tope duro de `construccionesPorDia` (60): desde la 61 no se lanza. `alertado`: la alerta de ese día ya salió. */
  readonly contador?: { readonly dia: string; readonly n: number; readonly alertado?: boolean };
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
  fijarContador(contador: { dia: string; n: number; alertado?: boolean }): void;
  /** `causa` solo con `fallida` (p. ej. `bloqueo_vencido`). */
  marcar(id: string, estado: 'completada' | 'fallida', ahora: number, causa?: string): void;
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
  /**
   * Modo «delegar» (el temporizador, que corre con la cuenta general y no debe crear builds): en vez de lanzar, `lanzarSiguiente` decide
   * igual, no toma el bloqueo y pide encolar la tarea de construcción del trabajo; el error de encolar sube como cualquier otro.
   * Con él, `constructorSitio` puede faltar.
   */
  readonly encolarLanzamiento?: (tenantId: string, trabajoId: string) => Promise<void>;
  /** Alerta `alerta: "sitio"`; por defecto un registro `error`. `estado` es el del build; `construccionesDia`, el contador diario. */
  readonly alertar?: (info: AlertaSitio) => void;
}

export interface AlertaSitio {
  readonly tenantId: string;
  readonly trabajoId: string;
  readonly minutos?: number;
  readonly estado?: string;
  readonly construccionesDia?: number;
}

/** Tope duro de construcciones por sitio y por día de La Paz (desde la 61 el trabajo queda `pendiente` hasta el día siguiente). */
export const TOPE_CONSTRUCCIONES_DIA = LIMITES_CONSOLA.construccionesPorDia;

export type ResultadoLanzamiento = 'sin-constructor' | 'nada' | 'lanzado' | 'esperar' | 'relanzado' | 'encolado' | 'tope-diario';

const RUTA_CONSTRUCCION = (t: string): string => `tenants/${t}/sitio/construccion`;
const RUTA_CONTADOR = (t: string): string => `tenants/${t}/sitio/construcciones`;
const COL_TRABAJOS = (t: string): string => `tenants/${t}/reconstrucciones`;
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * Lanza el trabajo pendiente más antiguo si el sitio está libre (o su bloqueo venció). Un pendiente con construcción en curso espera.
 * Con `encolarLanzamiento` (modo «delegar») no toma el bloqueo ni crea el build: pide encolar la tarea y devuelve `encolado`.
 */
export async function lanzarSiguiente(deps: DepsConstruccion, tenantId: string): Promise<ResultadoLanzamiento> {
  const constructor = deps.constructorSitio;
  const delegar = deps.encolarLanzamiento;
  if (constructor === undefined && delegar === undefined) return 'sin-constructor';
  const ahora = deps.reloj.ahora();
  const dia = diaLaPaz(ahora);
  const r = await deps.almacen.transaccion(tenantId, async (tx) => {
    const { bloqueo, ultimaImagen, contador } = await tx.estado();
    const pendientes = await tx.pendientes();
    const base = decidirBloqueo(bloqueo, ahora);
    const propio = bloqueo !== null && base !== 'lanzar' ? await tx.trabajo(bloqueo.trabajoId) : undefined;
    // Si el trabajo del bloqueo ya quedó `completada` el script desplegó y certificó: aunque el aviso de Cloud Build no haya llegado (o el
    // bloqueo haya vencido), la construcción terminó. Se cubren los pendientes anteriores a su inicio (como con SUCCESS), se guarda su
    // imagen y el bloqueo se da por libre. No se hace con `fallida`: la falla del build trae su alerta y su reintento.
    const cubierto = bloqueo !== null && propio?.estado === 'completada';
    let candidatos = pendientes;
    let imagenFinal = ultimaImagen;
    if (cubierto) {
      for (const p of pendientes) if (p.solicitadaEnMs < bloqueo.desdeMs) tx.marcar(p.id, 'completada', ahora);
      candidatos = pendientes.filter((p) => p.solicitadaEnMs >= bloqueo.desdeMs);
      imagenFinal = bloqueo.imagen === '' ? ultimaImagen : bloqueo.imagen;
    }
    const decision = cubierto ? 'lanzar' : base;
    if (decision === 'esperar') return { resultado: 'esperar' as const };
    // Un bloqueo vencido se cierra: el trabajo atascado pasa a `fallida` (causa `bloqueo_vencido`). Relanzarlo con el mismo trabajo no
    // avanza nunca (el script responde `repetido` a un trabajo `en_curso`); en su lugar se encola uno nuevo, motivo `reintento`.
    const atascado = decision === 'relanzar' && propio !== undefined && (propio.estado === 'en_curso' || propio.estado === 'pendiente') ? propio : undefined;
    if (atascado !== undefined) tx.marcar(atascado.id, 'fallida', ahora, 'bloqueo_vencido');
    const siguiente = candidatos.find((p) => p.id !== atascado?.id);
    const reintento = atascado !== undefined && atascado.motivo !== 'reintento' ? atascado : undefined;
    // Tope duro diario (también en modo delegar): sin lanzar ni encolar, el trabajo queda `pendiente` para el día siguiente. La alerta
    // sale una sola vez por día (la marca `alertado` viaja en el contador).
    const hechas = contador?.dia === dia ? contador.n : 0;
    if (siguiente !== undefined && hechas >= TOPE_CONSTRUCCIONES_DIA) {
      if (decision === 'relanzar' || cubierto) tx.liberar(imagenFinal);
      const avisar = contador?.dia !== dia || contador.alertado !== true;
      if (avisar) tx.fijarContador({ dia, n: hechas, alertado: true });
      return { resultado: 'tope' as const, trabajoId: siguiente.id, atascado, reintento, hechas, avisar };
    }
    if (siguiente === undefined || delegar !== undefined) {
      if (decision === 'relanzar' || cubierto) tx.liberar(imagenFinal);
      return siguiente === undefined
        ? { resultado: 'nada' as const, atascado, reintento }
        : { resultado: 'encolar' as const, trabajoId: siguiente.id, atascado, reintento };
    }
    tx.fijarBloqueo({ buildId: '', trabajoId: siguiente.id, desdeMs: ahora, imagen: deps.imagenActual ?? '' }, imagenFinal);
    const n = (contador?.dia === dia ? contador.n : 0) + 1;
    tx.fijarContador({ dia, n });
    return { resultado: decision === 'relanzar' ? ('relanzado' as const) : ('lanzado' as const), trabajoId: siguiente.id, atascado, reintento, n };
  });
  if (r.resultado === 'esperar') return r.resultado;
  if (r.atascado !== undefined) {
    (deps.alertar ?? alertaPorDefecto)({ tenantId, trabajoId: r.atascado.id, estado: 'bloqueo_vencido', minutos: Math.floor((ahora - r.atascado.solicitadaEnMs) / 60_000) });
  }
  if (r.reintento !== undefined) {
    await deps.almacen.crearPendiente(tenantId, `rec-reintento-${r.reintento.id}`, { version: r.reintento.version ?? 0, motivo: 'reintento', solicitadaEnMs: ahora });
  }
  // Sin otro pendiente, el reintento recién creado sale ahora (el bloqueo ya quedó libre).
  if (r.resultado === 'tope') {
    if (r.avisar) (deps.alertar ?? alertaPorDefecto)({ tenantId, trabajoId: r.trabajoId, construccionesDia: r.hechas });
    return 'tope-diario';
  }
  if (r.resultado === 'nada') return r.reintento !== undefined ? lanzarSiguiente(deps, tenantId) : 'nada';
  if (r.resultado === 'encolar') {
    await delegar?.(tenantId, r.trabajoId);
    return 'encolado';
  }
  let lanzada: { buildId: string; imagen: string };
  try {
    lanzada = await (constructor as ConstructorSitio).lanzar(tenantId, r.trabajoId);
  } catch (error) {
    if (!buildNoCreado(error)) {
      // Sin prueba de que el build no existe (tiempo agotado, respuesta sin id, error desconocido): pudo crearse. Liberar el bloqueo o
      // devolver la unidad daría dos builds a la vez o un contador falso. Se conserva el bloqueo (sin `buildId`): lo libera el cierre del
      // trabajo o su vencimiento a los 12 min, que cierra el trabajo y encola el reintento. Solo se alerta.
      (deps.alertar ?? alertaPorDefecto)({ tenantId, trabajoId: r.trabajoId, estado: 'lanzamiento_incierto' });
      return r.resultado;
    }
    // Hay prueba de que no quedó construcción: se libera el bloqueo (el trabajo sigue `pendiente`), se devuelve la unidad al contador del
    // día (una racha de fallas al crear el build no debe agotar el tope sin desplegar nada) y el error sube para que la cola reintente.
    await deps.almacen.transaccion(tenantId, async (tx) => {
      const { bloqueo, ultimaImagen, contador } = await tx.estado();
      if (bloqueo?.trabajoId !== r.trabajoId || bloqueo.desdeMs !== ahora) return;
      tx.liberar(ultimaImagen);
      if (contador?.dia === dia && contador.n > 0) tx.fijarContador({ ...contador, n: contador.n - 1 });
    });
    throw error;
  }
  try {
    await deps.almacen.transaccion(tenantId, async (tx) => {
      const { bloqueo, ultimaImagen } = await tx.estado();
      if (bloqueo?.trabajoId === r.trabajoId && bloqueo.desdeMs === ahora) tx.fijarBloqueo({ ...bloqueo, buildId: lanzada.buildId, imagen: lanzada.imagen }, ultimaImagen);
    });
  } catch {
    // El build SÍ existe: liberar el bloqueo (o reintentar la tarea) daría dos builds a la vez. Se conserva el bloqueo sin `buildId`: no
    // lo libera ningún aviso (no coincide), pero sí el cierre del trabajo (`completada`) o su vencimiento a los 12 min. Solo se alerta.
    (deps.alertar ?? alertaPorDefecto)({ tenantId, trabajoId: r.trabajoId, estado: 'build_id_no_guardado' });
  }
  return r.resultado;
}

/**
 * ¿Hay prueba de que `lanzar()` NO creó el build? Solo con un rechazo 4xx de Cloud Build (`estado` numérico 400-499) o un error que el
 * conector marca `noCreado: true` (falta de token, validación previa a la petición). `'red'`, `'respuesta'`, 5xx y errores
 * desconocidos no prueban nada: el build pudo crearse igual.
 */
export function buildNoCreado(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { estado, noCreado } = error as { estado?: unknown; noCreado?: unknown };
  return noCreado === true || (typeof estado === 'number' && estado >= 400 && estado < 500);
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
 *  - SUCCESS: se lee el trabajo propio. Solo si quedó `completada` se completan los pendientes con `solicitadaEnMs` anterior al
 *    inicio de la construcción y se guarda `ultimaImagen`. Si sigue `pendiente` o `fallida` (el script no desplegó) no es fallo ni se
 *    reintenta: se libera el bloqueo. Si sigue `en_curso` (lo tiene otro corredor) el bloqueo se mantiene y no se lanza nada.
 *  - Falla: el trabajo de la construcción pasa a `fallida` (si seguía `pendiente` o `en_curso`); ante TIMEOUT, INTERNAL_ERROR o EXPIRED (D7: no arrancó dentro de queueTtl) se
 *    se encola UN reintento (`rec-reintento-<trabajo>`, motivo `reintento`; un reintento que falla no se repite). Libera el bloqueo.
 *  - Toda falla (FAILURE, TIMEOUT, INTERNAL_ERROR, CANCELLED, EXPIRED) registra la alerta `sitio` (D7).
 *  - Después lanza el siguiente pendiente.
 */
export async function manejarAvisoConstruccion(
  deps: DepsConstruccion, aviso: { readonly tenantId: string; readonly buildId: string; readonly estado: EstadoBuild },
): Promise<'ignorado' | 'completado' | 'en-curso' | 'sin-desplegar' | 'fallido' | 'sin-constructor'> {
  if (deps.constructorSitio === undefined) return 'sin-constructor';
  if (!TERMINALES.has(aviso.estado)) return 'ignorado';
  const ahora = deps.reloj.ahora();
  const t = aviso.tenantId;
  const r = await deps.almacen.transaccion(t, async (tx) => {
    const { bloqueo, ultimaImagen } = await tx.estado();
    if (bloqueo === null || bloqueo.buildId !== aviso.buildId) return { resultado: 'ignorado' as const };
    const propio = await tx.trabajo(bloqueo.trabajoId);
    if (aviso.estado === 'SUCCESS') {
      // El script convierte «no desplegó» (código 10: 409, repetido, sin pendiente) en éxito: SUCCESS no prueba el despliegue.
      // Solo si el trabajo propio quedó `completada` el build cubre a los pendientes anteriores.
      // Si el trabajo sigue `en_curso` lo tiene OTRO corredor (el script respondió `repetido`): el sitio sigue ocupado. Liberar y lanzar
      // la siguiente construcción daría dos a la vez, y la más vieja, al terminar última, deshace lo publicado. El bloqueo se mantiene
      // hasta que el trabajo se cierre o venza (12 min).
      if (propio?.estado === 'en_curso') return { resultado: 'en-curso' as const };
      if (propio?.estado !== 'completada') {
        tx.liberar(ultimaImagen);
        return { resultado: 'sin-desplegar' as const };
      }
      const pendientes = await tx.pendientes();
      for (const p of pendientes) if (p.solicitadaEnMs < bloqueo.desdeMs) tx.marcar(p.id, 'completada', ahora);
      tx.liberar(bloqueo.imagen === '' ? ultimaImagen : bloqueo.imagen);
      return { resultado: 'completado' as const };
    }
    if (propio !== undefined && (propio.estado === 'en_curso' || propio.estado === 'pendiente')) tx.marcar(propio.id, 'fallida', ahora);
    tx.liberar(ultimaImagen);
    const reintentar = REINTENTABLES.has(aviso.estado) && propio !== undefined && propio.motivo !== 'reintento';
    return { resultado: 'fallido' as const, reintentar, propio, trabajoId: bloqueo.trabajoId };
  });
  // D7: toda falla o atraso (cualquier estado terminal distinto de SUCCESS) deja el registro de alerta del sitio.
  if (r.resultado === 'fallido') {
    (deps.alertar ?? alertaPorDefecto)({
      tenantId: t, trabajoId: r.trabajoId, estado: aviso.estado,
      minutos: r.propio === undefined ? 0 : Math.floor((ahora - r.propio.solicitadaEnMs) / 60_000),
    });
  }
  if (r.resultado === 'ignorado' || r.resultado === 'en-curso') return r.resultado;
  if (r.resultado === 'sin-desplegar') {
    await lanzarSiguiente(deps, t);
    return 'sin-desplegar';
  }
  if (r.resultado === 'fallido' && r.reintentar && r.propio !== undefined) {
    await deps.almacen.crearPendiente(t, `rec-reintento-${r.propio.id}`, {
      version: r.propio.version ?? 0, motivo: 'reintento', solicitadaEnMs: ahora,
    });
  }
  await lanzarSiguiente(deps, t);
  return r.resultado;
}

const alertaPorDefecto = (i: AlertaSitio): void => {
  logger.error('reconstrucción del sitio con falla, atraso o exceso', {
    alerta: 'sitio', tenantId: i.tenantId, trabajoId: i.trabajoId,
    ...(i.minutos === undefined ? {} : { minutos: i.minutos }), ...(i.estado === undefined ? {} : { estado: i.estado }),
    ...(i.construccionesDia === undefined ? {} : { construccionesDia: i.construccionesDia }),
  });
};

const etiquetaImagen = (imagen: string): string => imagen.replace(/^.*[:@]/, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 16);

/**
 * Red de seguridad del temporizador (cada 5 minutos), por tenant: (1) alerta de todo trabajo abierto de más de 10 minutos;
 * (2) si la imagen del constructor cambió respecto de `ultimaImagen`, encola una reconstrucción con motivo `codigo`;
 * (3) relanza un pendiente sin construcción o con el bloqueo vencido (más de 12 minutos).
 */
export async function redConstruccion(deps: DepsConstruccion, tenantId: string): Promise<ResultadoLanzamiento> {
  if (deps.constructorSitio === undefined && deps.encolarLanzamiento === undefined) return 'sin-constructor';
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

function aContador(d: Readonly<Record<string, unknown>> | undefined): Pick<EstadoConstruccion, 'contador'> {
  const n = num(d?.['n']);
  return typeof d?.['dia'] === 'string' && n !== undefined ? { contador: { dia: d['dia'], n, ...(d['alertado'] === true ? { alertado: true } : {}) } } : {};
}

const YA_EXISTE = 6;

export function almacenConstruccionFirestore(firestore: Firestore): AlmacenConstruccion {
  const txDe = (t: string, tx: Transaction): TxConstruccion => {
    const rutaB = firestore.doc(RUTA_CONSTRUCCION(t));
    const rutaC = firestore.doc(RUTA_CONTADOR(t));
    return {
      estado: async () => {
        const [b, c] = [await tx.get(rutaB), await tx.get(rutaC)];
        return { ...aEstado(b.data()), ...aContador(c.data()) };
      },
      pendientes: async () => {
        const s = await tx.get(firestore.collection(COL_TRABAJOS(t)).where('estado', '==', 'pendiente'));
        // Sin `limit`: con un tope, el trabajo más antiguo podría quedar fuera; se ordena aquí (un índice compuesto no hace falta).
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
      fijarContador: (c) => {
        tx.set(rutaC, { dia: c.dia, n: c.n, ...(c.alertado === true ? { alertado: true } : {}) });
      },
      marcar: (id, estado, ahora, causa) => {
        tx.update(firestore.doc(`${COL_TRABAJOS(t)}/${id}`), { estado, cerradaEnMs: ahora, ...(causa === undefined ? {} : { causa }) });
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
