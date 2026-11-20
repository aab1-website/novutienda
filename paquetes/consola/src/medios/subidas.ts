import { registrarAuditoria, type Actor, type LimiteTasa, type TransaccionIdentidad } from '@novutienda/nucleo';
import { anotarCambio, leerEstadoSitio } from '../cambios.js';
import { ArchivoNoAdmitido, ErrorConsola, ProcesamientoNoDisponible, type CodigoErrorConsola } from '../errores.js';
import { cupoPortadaDelPlan, LIMITES_CONSOLA } from '../limites.js';
import { agendarLogoVivo, escribirLogoVivo, leerPublicadoParaLogo, proyectarLogoPublico } from '../logo-publico.js';
import { exigirRol, ROLES } from '../permisos.js';
import { PLANTILLAS } from '../plantillas.js';
import type { AlmacenMedios, BaseDatosConsola, CatalogoPuerto, ConsultaSubidas, DisparadorSitio, ProcesadorMedios, Reloj } from '../puertos.js';
import {
  dirTemporal, ID_NEGOCIO, ID_PORTADA, ID_PRODUCTO, ID_SUBIDA, prefijoTemporal, rutaCarrusel, rutaFicha, rutaPublicado, rutaMedio, rutaOriginal, rutaPublicaMedio, rutaSeccion, rutaSitio,
  rutaSubida, tenantValido,
} from '../rutas.js';
import { mediosDeSeccion, validarSeccion } from '../secciones.js';
import { esObjeto } from '../validar.js';
import { contieneMetadatos } from './metadatos.js';
import { nombreVersion, planificarProcesamiento, type ItemPlan, type PlanProcesamiento } from './plan.js';
import { BYTES_INICIALES, detectarArchivo, FORMATOS_LOGO, type FormatoArchivo, type TipoMedio, type TipoSubida } from './tipos-archivo.js';
import { escribirUsoMedios, leerUsoMedios, liberarEnUso, reservarEnUso, type UsoMedios } from './uso.js';

/** Texto para el usuario cuando el procesamiento de video no está disponible (el archivo no tiene la culpa). */
export const MENSAJE_VIDEO_NO_DISPONIBLE = 'El procesamiento de video no está disponible por ahora; su archivo no tiene problemas. Intente más tarde.';

export interface DepsMedios {
  readonly db: BaseDatosConsola;
  readonly almacen: AlmacenMedios;
  readonly procesador: ProcesadorMedios;
  readonly catalogo: CatalogoPuerto;
  readonly reloj: Reloj;
  /**
   * Logo vivo: con algo ya publicado, subir o quitar el logo actualiza `publicado/sitio.logo` y agenda la reconstrucción por aquí.
   * Opcional: sin él se actualiza igual lo publicado y la reconstrucción queda para el próximo disparo (publicación o diaria).
   */
  readonly disparador?: DisparadorSitio;
  /** Límite de frecuencia para reservar logos (por comercio). Sin él no se limita. */
  readonly limiteLogo?: LimiteTasa;
  /** Registro de avisos sin datos personales (solo cantidades). */
  readonly avisar?: (mensaje: string, datos: Readonly<Record<string, number>>) => void;
  /** Generador del identificador de invocación (solo para pruebas; por defecto aleatorio). */
  readonly nuevoId?: () => string;
}

/** Tope para borrar la copia pública de un medio aunque el sitio no se haya reconstruido: 30 días. */
const TOPE_BORRADO_PUBLICO_MS = 30 * 24 * 60 * 60 * 1000;

/** Tope de una versión procesada de imagen que se lee completa para buscar metadatos. */
const MAX_BYTES_VERSION_IMAGEN = 8 * 1024 * 1024;

type EstadoSubida = 'reservada' | 'procesando' | 'procesada' | 'borrando' | 'rechazada';
type Destino = 'eliminar' | 'rechazada' | 'vencida';

interface Subida {
  readonly id: string;
  readonly productoId: string;
  readonly tipo: TipoSubida;
  readonly bytes: number;
  readonly estado: EstadoSubida;
  readonly rutaOriginal: string;
  readonly creadaEn: number;
  readonly venceEn: number;
  readonly por: string;
  readonly destino?: Destino;
  readonly motivo?: string;
  readonly rutas?: readonly string[];
  /**
   * Solo logos reemplazados o quitados: versiones públicas que se borran más tarde (`borrarDesde`, ms), cuando el sitio ya construido
   * no puede seguir usándolas. `limpiarSubidas` las encuentra porque la subida queda en `borrando` hasta entonces.
   */
  readonly rutasDiferidas?: readonly string[];
  readonly borrarDesde?: number;
  /**
   * Solo medios borrados con el sitio ya publicado: `version` de `publicado/estado` al borrar. Las versiones públicas
   * (`rutasDiferidas`) se borran cuando `sitio/ultimaReconstruccion` es `completada` con una `version` MAYOR (el sitio ya
   * reconstruido no las usa) o, como tope, al llegar `borrarTopeEn` (ms). Hasta entonces se reprograma.
   */
  readonly borrarTrasVersion?: number;
  readonly borrarTopeEn?: number;
  /** Solo con `procesando`: identificador de la invocación que reclamó la subida y cuándo vence ese reclamo. */
  readonly procesandoPor?: string;
  readonly procesandoVenceEn?: number;
}

function leerSubida(d: Readonly<Record<string, unknown>> | undefined): Subida | undefined {
  if (d === undefined) return undefined;
  const { id, productoId, tipo, bytes, estado, creadaEn, venceEn, por } = d;
  if (
    typeof id !== 'string' || typeof productoId !== 'string' || (tipo !== 'foto' && tipo !== 'video' && tipo !== 'logo' && tipo !== 'portada') ||
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
    ...(Array.isArray(d['rutasDiferidas']) ? { rutasDiferidas: d['rutasDiferidas'].filter((r): r is string => typeof r === 'string') } : {}),
    ...(typeof d['borrarDesde'] === 'number' ? { borrarDesde: d['borrarDesde'] } : {}),
    ...(typeof d['borrarTrasVersion'] === 'number' ? { borrarTrasVersion: d['borrarTrasVersion'] } : {}),
    ...(typeof d['borrarTopeEn'] === 'number' ? { borrarTopeEn: d['borrarTopeEn'] } : {}),
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
  /** Con `tipo: 'logo'` debe ser `_negocio` y con `tipo: 'portada'`, `_portada` (destinos fijos; no se verifican contra el catálogo). */
  readonly productoId: string;
  readonly tipo: TipoSubida;
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
  // El logo y la portada son solo del administrador: el servidor lo exige antes de reservar (la regla de Storage no distingue sup de adm).
  exigirRol(e.actor, t, e.tipo === 'logo' || e.tipo === 'portada' ? ROLES.administrar : ROLES.editarFichas);
  if (!ID_SUBIDA.test(e.subidaId)) throw new ErrorConsola('entrada-invalida', 'subidaId inválido');
  if (e.tipo !== 'foto' && e.tipo !== 'video' && e.tipo !== 'logo' && e.tipo !== 'portada') throw new ErrorConsola('entrada-invalida', 'tipo debe ser foto, video, logo o portada');
  if (e.tipo === 'logo' ? e.productoId !== ID_NEGOCIO : e.tipo === 'portada' ? e.productoId !== ID_PORTADA : !ID_PRODUCTO.test(e.productoId)) throw new ErrorConsola('entrada-invalida', 'productoId inválido');
  if (!Number.isSafeInteger(e.bytes) || e.bytes <= 0) throw new ErrorConsola('entrada-invalida', 'tamaño inválido');
  if ((e.tipo === 'foto' || e.tipo === 'portada') && e.bytes > LIMITES_CONSOLA.bytesFoto) throw new ErrorConsola('limite', 'La foto supera 15 MB');
  if (e.tipo === 'logo' && e.bytes > LIMITES_CONSOLA.bytesLogo) throw new ErrorConsola('limite', 'El logo supera 2 MB');
  if (e.tipo === 'video' && e.bytes > LIMITES_CONSOLA.bytesVideo) throw new ErrorConsola('limite', 'El video supera 200 MB');
  if (e.tipo === 'video' && (await deps.procesador.disponible?.('video')) === false) {
    throw new ErrorConsola('no-disponible', MENSAJE_VIDEO_NO_DISPONIBLE);
  }
  const ahora = deps.reloj.ahora();
  // Límite de frecuencia: el cupo se consume solo con una reserva nueva, no en reintentos idempotentes de la misma `subidaId`.
  // Es por instancia (ventana en memoria): con varias instancias el tope real puede llegar a 3 veces el nominal.
  if (e.tipo === 'logo' && deps.limiteLogo !== undefined && leerSubida(await leerDoc(deps.db, rutaSubida(t, e.subidaId))) === undefined
    && !(await deps.limiteLogo.intentar(`logo:${t}`, ahora)).permitido) {
    throw new ErrorConsola('limite', 'Se subieron demasiados logos en poco tiempo; intente más tarde');
  }
  const ruta = rutaOriginal(t, e.productoId, e.subidaId);

  return deps.db.runTransaction(async (tx) => {
    // El producto se lee con esta misma transacción, antes de toda escritura.
    if (e.tipo !== 'logo' && e.tipo !== 'portada' && !(await deps.catalogo.existeProductoEnTransaccion(tx, t, e.productoId))) throw new ErrorConsola('no-encontrado', 'El producto no existe');
    const previa = leerSubida((await tx.get(rutaSubida(t, e.subidaId))).data());
    const uso = await leerUsoMedios(tx, t);
    const enSubida = e.tipo === 'logo' ? (await tx.get(rutaSitio(t, 'logoEnSubida'))).data()?.['hasta'] : undefined;
    if (previa !== undefined) {
      if (previa.productoId === e.productoId && previa.tipo === e.tipo && previa.bytes === e.bytes && previa.estado === 'reservada') {
        return { subidaId: previa.id, rutaOriginal: previa.rutaOriginal, venceEn: previa.venceEn };
      }
      throw new ErrorConsola('conflicto', 'Esa subida ya se inició con otro archivo; vuelva a elegirlo');
    }
    // El cupo de fotos de portada sale del plan del comercio (se lee antes de toda escritura).
    const cupoPortada = e.tipo === 'portada' ? cupoPortadaDelPlan((await tx.get(`tenants/${t}`)).data()?.['plan']) : 0;
    escribirUsoMedios(tx, t, reservarEnUso(uso, e.productoId, e.tipo, e.bytes, cupoPortada));
    const venceEn = ahora + LIMITES_CONSOLA.vigenciaReservaMs;
    const campos: Pick<Subida, CampoReserva> = {
      estado: 'reservada', venceEn, productoId: e.productoId, por: e.actor.uid, bytes: e.bytes, tipo: e.tipo,
    };
    const s: Subida = { id: e.subidaId, rutaOriginal: ruta, creadaEn: ahora, ...campos };
    tx.set(rutaSubida(t, e.subidaId), aDoc(s));
    // Marca «hay un logo en subida» hasta que la reserva (y su procesamiento) ya no pueda estar viva: mientras dure, la limpieza
    // diferida de logos anteriores no borra nada. No hace falta apagarla: caduca sola.
    if (e.tipo === 'logo') {
      const hasta = venceEn + LIMITES_CONSOLA.vencimientoProcesandoMs;
      tx.set(rutaSitio(t, 'logoEnSubida'), { hasta: typeof enSubida === 'number' ? Math.max(enSubida, hasta) : hasta });
    }
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

/**
 * Rutas de objetos que se pueden borrar al reemplazar o quitar un logo: solo las de la carpeta `_negocio` del propio comercio.
 * Si el documento no es un logo (`esLogo` falso) no se borra nada; cualquier otra ruta se descarta y se registra sin datos personales.
 */
function esDelLogo(m: { readonly tipo?: unknown; readonly productoId?: unknown } | undefined, sub: Subida | undefined): boolean {
  return (m === undefined || (m.tipo === 'logo' && m.productoId === ID_NEGOCIO)) && (sub === undefined || (sub.tipo === 'logo' && sub.productoId === ID_NEGOCIO));
}

function rutasPropiasDelLogo(deps: DepsMedios, t: string, esLogo: boolean, candidatas: readonly unknown[]): string[] {
  const prefijos = [`tenants/${t}/privado/originales/${ID_NEGOCIO}/`, `tenants/${t}/publico/medios/${ID_NEGOCIO}/`];
  const validas = candidatas.filter((r): r is string => typeof r === 'string' && r !== '');
  const propias = esLogo ? validas.filter((r) => prefijos.some((p) => r.startsWith(p)) && !r.includes('..')) : [];
  if (propias.length !== validas.length) deps.avisar?.('logo: se omitió el borrado de rutas ajenas a la carpeta del logo', { descartadas: validas.length - propias.length });
  return propias;
}

/**
 * Reparte las rutas de un logo que deja de ser el vigente: el original privado y lo no público se borran ya; las versiones públicas
 * (`tenants/{t}/publico/...`) quedan diferidas `esperaBorradoLogoMs`. La cuota (que cuenta solo el original) se libera al reemplazar:
 * el original sí se borra en ese momento, así que no hay holgura de cuota; las versiones públicas no cuentan en ella.
 */
function repartirRutasLogo(t: string, rutas: readonly string[], ahora: number): Pick<Subida, 'rutas' | 'rutasDiferidas' | 'borrarDesde'> & Partial<Pick<Subida, 'venceEn'>> {
  const publico = `tenants/${t}/publico/`;
  const diferidas = rutas.filter((r) => r.startsWith(publico));
  return {
    rutas: rutas.filter((r) => !r.startsWith(publico)),
    // `venceEn` = hora de borrado: la cola de `borrando` se ordena por cuándo toca borrar.
    ...(diferidas.length === 0 ? {} : { rutasDiferidas: diferidas, borrarDesde: ahora + LIMITES_CONSOLA.esperaBorradoLogoMs, venceEn: ahora + LIMITES_CONSOLA.esperaBorradoLogoMs }),
  };
}

/** Versión publicada del logo (PNG y WebP, lado mayor de 512 como máximo). */
export interface VersionLogo {
  readonly clase: 'logo';
  readonly lado: number;
  readonly formato: 'png' | 'webp';
  readonly ruta: string;
  readonly bytes: number;
}

/** Documento `medios/{id}` de un logo: aparte de `Medio` para que el sitio y las fichas no lo tomen por una foto de producto. */
export interface MedioLogo extends Omit<Medio, 'tipo' | 'versiones'> {
  readonly tipo: 'logo';
  readonly versiones: readonly VersionLogo[];
}

export type MedioSubido = Medio | MedioLogo;

/** Causa técnica de un fallo para el registro del servidor: `nombre: mensaje`, sin rutas y con 200 caracteres como máximo. */
function causaDe(err: unknown): string {
  const crudo = err instanceof Error ? `${err.name}: ${err.message}` : 'desconocido';
  return crudo.replace(/\S*\/\S*/g, '[ruta]').slice(0, 200);
}

/** Libera la reserva y borra lo subido. Siempre termina lanzando el error que ve el usuario. */
async function rechazar(
  deps: DepsMedios, t: string, s: Subida, reclamo: string, codigo: CodigoErrorConsola, motivo: string, extras: readonly string[], causa?: string,
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
  throw new ErrorConsola(codigo, motivo, [], causa);
}

/**
 * Borra los objetos de una subida en estado `borrando` y la cierra (`rechazada`) o la elimina. Devuelve `false` si no hizo nada
 * (no estaba en `borrando`, o es un logo cuyas versiones públicas aún no toca borrar, o hay un logo en subida y se reintenta después).
 */
async function borrarYCerrar(deps: DepsMedios, t: string, subidaId: string): Promise<boolean> {
  const s = leerSubida((await leerDoc(deps.db, rutaSubida(t, subidaId))));
  if (s?.estado !== 'borrando') return false;
  const diferidas = s.rutasDiferidas ?? [];
  const propias = s.rutas ?? [s.rutaOriginal];
  const aunNoToca = diferidas.length > 0 && deps.reloj.ahora() < (s.borrarDesde ?? 0);
  // Ya borró lo que tocaba y solo espera: sale antes de tocar el almacén.
  if (aunNoToca && propias.length === 0) return false;
  if (propias.length > 0) await deps.almacen.borrar(propias);
  if (diferidas.length > 0) {
    // Logo reemplazado o quitado: sus versiones públicas esperan a que el sitio ya no las use. La subida sigue en `borrando`
    // (con `venceEn = borrarDesde`) y cada pasada de `limpiarSubidas` vuelve aquí.
    if (aunNoToca) {
      await deps.db.runTransaction(async (tx) => {
        const actual = leerSubida((await tx.get(rutaSubida(t, subidaId))).data());
        if (actual?.estado === 'borrando') tx.set(rutaSubida(t, subidaId), aDoc({ ...actual, rutas: [] }));
      });
      return true;
    }
    // Justo antes de borrar se vuelve a leer, en una transacción, el documento de la subida, el logo vigente y la marca de «logo en
    // subida»: se borra solo lo que SIGUE pendiente y no es vigente, y nada mientras un logo se esté subiendo (se reintenta después).
    const ahora = deps.reloj.ahora();
    const aBorrar = await deps.db.runTransaction(async (tx): Promise<readonly string[] | undefined> => {
      const actual = leerSubida((await tx.get(rutaSubida(t, subidaId))).data());
      const vigente = new Set(leerDocLogo((await tx.get(rutaSitio(t, 'logo'))).data())?.versiones.map((v) => v.ruta));
      const hasta = (await tx.get(rutaSitio(t, 'logoEnSubida'))).data()?.['hasta'];
      const ultima = (await tx.get(rutaSitio(t, 'ultimaReconstruccion'))).data();
      const estadoPub = (await tx.get(rutaPublicado(t, 'estado'))).data();
      // La versión de `publicado/estado` también sube con el precio vivo y el logo vivo, sin volver a publicar las fotos: por eso,
      // además de la reconstrucción posterior, se exige que ninguna copia `publicado/*` siga nombrando las rutas del medio.
      const nombresPublicos = (actual?.rutasDiferidas ?? []).map((r) => r.slice(r.lastIndexOf('/') + 1));
      let enUsoPublicado = false;
      if (actual?.borrarTrasVersion !== undefined && estadoPub !== undefined) {
        const ids = (clave: string, prefijo: string): string[] => (Array.isArray(estadoPub[clave]) ? (estadoPub[clave] as unknown[]) : []).filter((x): x is string => typeof x === 'string').map((x) => `${prefijo}${x}`);
        const docs = [...ids('productos', 'producto__'), ...ids('secciones', 'seccion__'), ...ids('carruseles', 'carrusel__'), 'sitio', 'negocio'];
        for (const d of docs) {
          const texto = JSON.stringify((await tx.get(rutaPublicado(t, d))).data() ?? {});
          if (nombresPublicos.some((n) => n !== '' && texto.includes(n))) enUsoPublicado = true;
        }
      }
      if (actual?.estado !== 'borrando') return [];
      if (typeof hasta === 'number' && hasta > ahora) return undefined;
      const marca = actual.borrarTrasVersion;
      const reconstruido = ultima?.['estado'] === 'completada' && typeof ultima['version'] === 'number' && marca !== undefined && ultima['version'] > marca;
      const vencioTope = actual.borrarTopeEn !== undefined && ahora >= actual.borrarTopeEn;
      if (marca !== undefined && (!reconstruido || enUsoPublicado) && !vencioTope) {
        // Medio borrado con el sitio publicado: el sitio todavía puede usar su copia pública hasta que se reconstruya con una
        // versión posterior (o venza el tope). Se reprograma sin tapar la cola.
        tx.set(rutaSubida(t, subidaId), aDoc({ ...actual, rutas: [], venceEn: ahora + LIMITES_CONSOLA.esperaBorradoLogoMs }));
        return undefined;
      }
      return (actual.rutasDiferidas ?? []).filter((r) => !vigente.has(r));
    });
    if (aBorrar === undefined) return false;
    if (aBorrar.length > 0) await deps.almacen.borrar(aBorrar);
  }
  await deps.almacen.borrarPrefijo?.(prefijoTemporal(t, subidaId)); // restos de invocaciones que murieron a medias
  await deps.db.runTransaction(async (tx) => {
    const indice = await leerIndiceDiferidas(tx, t);
    const actual = leerSubida((await tx.get(rutaSubida(t, subidaId))).data());
    if (actual?.estado !== 'borrando') return;
    if (indice.includes(subidaId)) escribirIndiceDiferidas(tx, t, indice.filter((x) => x !== subidaId));
    if (actual.destino === 'rechazada') {
      const { rutas: _r, ...resto } = actual;
      void _r;
      tx.set(rutaSubida(t, subidaId), aDoc({ ...resto, estado: 'rechazada' }));
    } else tx.delete(rutaSubida(t, subidaId));
  });
  return true;
}

/** `sitio/logoDiferidas`: ids de las subidas de logo con versiones públicas esperando su borrado (para quitarles lo que un logo nuevo comparte). */
/**
 * Tope de ids recordados: 50. Si se supera, se descartan los más antiguos (se avisa con la cantidad). Un id descartado deja de recibir
 * el recorte de rutas compartidas al confirmar un logo nuevo, pero sigue protegido: la limpieza vuelve a leer el logo vigente y la
 * marca de logo en subida antes de borrar.
 */
const MAX_DIFERIDAS = 50;
async function leerIndiceDiferidas(tx: TransaccionIdentidad, t: string): Promise<string[]> {
  const ids = (await tx.get(rutaSitio(t, 'logoDiferidas'))).data()?.['ids'];
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
}
function escribirIndiceDiferidas(
  tx: TransaccionIdentidad, t: string, ids: readonly string[], avisar?: DepsMedios['avisar'],
): void {
  if (ids.length > MAX_DIFERIDAS) avisar?.('logo: el índice de borrados diferidos superó su tope y se descartaron los más antiguos', { descartados: ids.length - MAX_DIFERIDAS });
  tx.set(rutaSitio(t, 'logoDiferidas'), { ids: ids.slice(-MAX_DIFERIDAS) });
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
): Promise<{ readonly subida: Subida } | { readonly medio: MedioSubido }> {
  return deps.db.runTransaction(async (tx) => {
    const actual = leerSubida((await tx.get(rutaSubida(t, subidaId))).data());
    if (actual === undefined) throw new ErrorConsola('no-encontrado', 'La subida no existe');
    const ahora = deps.reloj.ahora();
    if (actual.estado === 'procesada') {
      const m = (await tx.get(rutaMedio(t, subidaId))).data();
      if (m !== undefined) return { medio: m as unknown as MedioSubido };
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
export async function finalizarSubida(deps: DepsMedios, e: EntradaFinalizar): Promise<MedioSubido> {
  const t = tenantValido(e.tenantId);
  const rol = exigirRol(e.actor, t, ROLES.editarFichas);
  if (!ID_SUBIDA.test(e.subidaId)) throw new ErrorConsola('entrada-invalida', 'subidaId inválido');
  // Exclusión mutua: el disparador de Storage y la acción explícita pueden finalizar la MISMA subida a la vez. Solo gana
  // quien pasa la subida de `reservada` a `procesando` en una transacción; el resto no procesa ni rechaza nada.
  const reclamo = (deps.nuevoId ?? idAleatorio)();
  // El rol del logo se exige ANTES de pasar la subida a `procesando`: un `sup` no la deja reclamada ni la altera.
  const tipoPrevio = rol === 'adm' ? undefined : leerSubida(await leerDoc(deps.db, rutaSubida(t, e.subidaId)))?.tipo;
  if (rol !== 'adm' && (tipoPrevio === 'logo' || tipoPrevio === 'portada')) {
    throw new ErrorConsola('no-autorizado', 'No tiene permiso para esta acción');
  }
  const r = await reclamar(deps, t, e.subidaId, reclamo);
  if ('medio' in r) {
    if ((r.medio.tipo === 'logo' || r.medio.productoId === ID_PORTADA) && rol !== 'adm') throw new ErrorConsola('no-autorizado', 'No tiene permiso para esta acción');
    return r.medio;
  }
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
): Promise<MedioSubido> {
  const tope = s.tipo === 'logo' ? LIMITES_CONSOLA.bytesLogo : s.tipo === 'foto' || s.tipo === 'portada' ? LIMITES_CONSOLA.bytesFoto : LIMITES_CONSOLA.bytesVideo;
  const real = await deps.almacen.tamano(s.rutaOriginal);
  if (real === undefined) throw new ErrorConsola('no-encontrado', 'El archivo todavía no llegó');
  if (real === 0) return rechazar(deps, t, s, reclamo, 'entrada-invalida', 'El archivo está vacío', []);
  if (real > s.bytes || real > tope) {
    return rechazar(deps, t, s, reclamo, 'limite', s.tipo === 'logo' ? 'El logo supera 2 MB' : s.tipo === 'foto' || s.tipo === 'portada' ? 'La foto supera 15 MB' : 'El video supera 200 MB', []);
  }

  const detectado = detectarArchivo(await deps.almacen.leerInicio(s.rutaOriginal, BYTES_INICIALES));
  // El logo es una imagen (la misma detección que las fotos) pero solo JPG, PNG o WebP: SVG y HEIC no se admiten.
  const tipoEsperado = s.tipo === 'logo' || s.tipo === 'portada' ? 'foto' : s.tipo;
  if (detectado?.tipo !== tipoEsperado || (s.tipo === 'logo' && !FORMATOS_LOGO.includes(detectado.formato))) {
    return rechazar(deps, t, s, reclamo, 'tipo-no-permitido', 'El contenido del archivo no corresponde a un tipo permitido', []);
  }

  const dirTmp = dirTemporal(t, s.id, reclamo);
  const publicadas: string[] = [];
  const temporales: string[] = [];
  let medio: MedioSubido;
  try {
    const tipoProcesador = s.tipo === 'logo' || s.tipo === 'portada' ? 'foto' : s.tipo;
    const info = await deps.procesador.inspeccionar(s.rutaOriginal, tipoProcesador);
    if (!Number.isInteger(info.ancho) || !Number.isInteger(info.alto) || info.ancho < 1 || info.alto < 1) {
      return await rechazar(deps, t, s, reclamo, 'procesamiento', 'No se pudieron leer las dimensiones del archivo', []);
    }
    if (s.tipo !== 'video' && info.ancho * info.alto > (s.tipo === 'logo' ? LIMITES_CONSOLA.pixelesLogoMax : LIMITES_CONSOLA.pixelesFotoMax)) {
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
    const salida = await deps.procesador.procesar({ origen: s.rutaOriginal, tipo: tipoProcesador, plan, destinoTemporal: dirTmp });
    temporales.push(...salida.map((v) => v.rutaTemporal));
    const falla = validarSalida(plan, salida, dirTmp);
    if (falla !== undefined) return await rechazar(deps, t, s, reclamo, 'procesamiento', 'No se pudo procesar el archivo', temporales);

    const versiones: (ItemPlan & { readonly ruta: string; readonly bytes: number })[] = [];
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
    const comun = {
      id: s.id, productoId: s.productoId, formatoOriginal: detectado.formato, bytesOriginal: real,
      rutaOriginal: s.rutaOriginal, ancho: info.ancho, alto: info.alto,
      ...(info.duracionSeg === undefined ? {} : { duracionSeg: info.duracionSeg }),
      creadoEn: deps.reloj.ahora(), por: e.actor.uid,
    };
    medio = s.tipo === 'logo'
      ? { ...comun, tipo: 'logo', versiones: versiones.filter((v): v is VersionLogo => v.clase === 'logo' && (v.formato === 'png' || v.formato === 'webp')) }
      : { ...comun, tipo: s.tipo === 'portada' ? 'foto' : s.tipo, versiones: versiones.filter((v): v is VersionMedio => v.clase !== 'logo' && v.formato !== 'png') };
  } catch (err) {
    if (err instanceof ErrorConsola) throw err; // `rechazar` ya limpió
    if (err instanceof ProcesamientoNoDisponible) {
      return rechazar(deps, t, s, reclamo, 'no-disponible', MENSAJE_VIDEO_NO_DISPONIBLE, [...temporales, ...publicadas]);
    }
    if (err instanceof ArchivoNoAdmitido) {
      return rechazar(deps, t, s, reclamo, 'tipo-no-permitido', err.message, [...temporales, ...publicadas]);
    }
    return rechazar(deps, t, s, reclamo, 'procesamiento', 'No se pudo procesar el archivo', [...temporales, ...publicadas], causaDe(err));
  }

  const ahoraIso = new Date(deps.reloj.ahora()).toISOString();
  let logoAnterior: string | undefined;
  let agendar: number | null = null;
  try {
    await deps.db.runTransaction(async (tx) => {
      const actual = leerSubida((await tx.get(rutaSubida(t, s.id))).data());
      const uso = await leerUsoMedios(tx, t);
      const estado = await leerEstadoSitio(tx, t);
      // Logo: se lee el vigente (todas las lecturas antes de escribir) para reemplazarlo en esta misma transacción.
      const previo = s.tipo === 'logo' ? await leerLogoEnTx(tx, t) : undefined;
      const previoMedio = previo === undefined || previo.medioId === s.id ? undefined : (await tx.get(rutaMedio(t, previo.medioId))).data() as Partial<MedioSubido> | undefined;
      const previoSubida = previoMedio === undefined || previo === undefined ? undefined : leerSubida((await tx.get(rutaSubida(t, previo.medioId))).data());
      const publicadoLogo = s.tipo === 'logo' ? await leerPublicadoParaLogo(tx, t) : undefined;
      const indiceDif = s.tipo === 'logo' ? await leerIndiceDiferidas(tx, t) : [];
      const pendientes: { id: string; sub: Subida }[] = [];
      for (const id of indiceDif) {
        const sub = leerSubida((await tx.get(rutaSubida(t, id))).data());
        if (sub?.estado === 'borrando' && (sub.rutasDiferidas ?? []).length > 0) pendientes.push({ id, sub });
      }
      if (actual?.estado !== 'procesando' || actual.procesandoPor !== reclamo) {
        throw new ErrorConsola('estado', 'La subida ya fue resuelta por otra solicitud');
      }
      agendar = null; // el cuerpo se reintenta: cada intento decide de nuevo
      let logoVivo = false;
      // Si el archivo real es más chico que lo reservado, se devuelve la diferencia a la cuota.
      let usoNuevo: UsoMedios = { ...uso, bytes: Math.max(0, uso.bytes - (s.bytes - real)) };
      if (s.tipo === 'logo' && publicadoLogo !== undefined) {
        tx.set(rutaSitio(t, 'logo'), { ...docLogo(medio), actualizadoEn: ahoraIso, por: e.actor.uid });
        // Logo vivo, en la MISMA transacción que el reemplazo: `publicado/sitio.logo` pasa a las versiones nuevas a la vez que
        // `sitio/logo`, y los objetos del anterior se borran solo DESPUÉS del commit. Si algo falla, o nada cambia o ambos cambian.
        const vivo = escribirLogoVivo(tx, t, publicadoLogo, proyectarLogoPublico(t, docLogo(medio)), deps.reloj);
        logoVivo = vivo.aplicado;
        agendar = vivo.programar;
        // Versiones públicas que otros logos reemplazados aún tienen pendientes y que el nuevo comparte: dejan de estar pendientes
        // (misma transacción), para que la limpieza diferida nunca borre algo que el logo vigente usa.
        const nuevasRutas = new Set(medio.versiones.map((v) => v.ruta));
        let indiceNuevo = pendientes.map((x) => x.id);
        for (const { id, sub } of pendientes) {
          const quedan = (sub.rutasDiferidas ?? []).filter((r) => !nuevasRutas.has(r));
          if (quedan.length === (sub.rutasDiferidas ?? []).length) continue;
          const { rutasDiferidas: _d, borrarDesde: _b, ...resto } = sub;
          void _d; void _b;
          tx.set(rutaSubida(t, id), aDoc(quedan.length === 0 ? { ...resto, venceEn: 0 } : { ...sub, rutasDiferidas: quedan }));
          if (quedan.length === 0) indiceNuevo = indiceNuevo.filter((x) => x !== id);
        }
        // Un solo logo vigente: el anterior (su medio, su original y sus versiones) se borra; las versiones que el nuevo comparte
        // por contenido idéntico (misma ruta con hash) se conservan. Solo se tocan objetos del propio logo del negocio.
        if (previo !== undefined && previoMedio !== undefined && !esDelLogo(previoMedio, previoSubida)) {
          // La referencia vigente apunta a algo que no es un logo de `_negocio`: solo se reemplaza la referencia; no se toca
          // ni su medio, ni su cuota, ni su subida.
          deps.avisar?.('logo: la referencia anterior no apuntaba a un logo; solo se reemplazó la referencia', {});
        } else if (previo !== undefined && previoMedio !== undefined) {
          const nuevas = new Set(medio.versiones.map((v) => v.ruta));
          const rutas = repartirRutasLogo(t, rutasPropiasDelLogo(deps, t, true,
            [previoMedio.rutaOriginal, ...(previoMedio.versiones ?? []).map((v) => v.ruta)].filter((r) => !nuevas.has(r as string))), deps.reloj.ahora());
          usoNuevo = liberarEnUso(usoNuevo, ID_NEGOCIO, 'logo', previoMedio.bytesOriginal ?? 0);
          tx.delete(rutaMedio(t, previo.medioId));
          const base: Subida = previoSubida ?? {
            id: previo.medioId, productoId: ID_NEGOCIO, tipo: 'logo', bytes: previoMedio.bytesOriginal ?? 0, estado: 'procesada',
            rutaOriginal: previoMedio.rutaOriginal ?? '', creadaEn: previoMedio.creadoEn ?? 0, venceEn: 0, por: e.actor.uid,
          };
          tx.set(rutaSubida(t, previo.medioId), aDoc({ ...base, estado: 'borrando', destino: 'eliminar', ...rutas }));
          if (rutas.rutasDiferidas !== undefined) indiceNuevo = [...indiceNuevo, previo.medioId];
          logoAnterior = previo.medioId;
        }
        if (indiceNuevo.length !== indiceDif.length || indiceNuevo.some((x, i) => x !== indiceDif[i])) escribirIndiceDiferidas(tx, t, indiceNuevo, deps.avisar);
      }
      escribirUsoMedios(tx, t, usoNuevo);
      tx.set(rutaMedio(t, s.id), { ...medio });
      tx.set(rutaSubida(t, s.id), aDoc({ ...sinReclamo(actual), estado: 'procesada', bytes: real }));
      if (!logoVivo) anotarCambio(tx, t, estado, ahoraIso);
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
    if (ganador !== undefined) return ganador as unknown as MedioSubido;
    throw err;
  }
  await deps.almacen.borrar(temporales).catch(() => undefined); // los temporales no afectan los datos
  await agendarLogoVivo(deps.disparador, t, agendar).catch(() => undefined); // el temporizador diario cubre un agendado perdido
  // El borrado de los objetos del logo anterior se reintenta en `limpiarSubidas` si falla (queda en `borrando`).
  if (logoAnterior !== undefined) await borrarYCerrar(deps, t, logoAnterior).catch(() => undefined);
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
  readonly medio?: MedioSubido;
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
    return m === undefined ? { estado: 'reservada' } : { estado: 'procesada', medio: m as unknown as MedioSubido };
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

/** Uso en una sección guardada: bloquea el borrado (hay que quitarla de ahí a mano). */
async function medioEnSecciones(tx: TransaccionIdentidad, t: string, medioId: string): Promise<string | undefined> {
  const indice = (await tx.get(rutaSitio(t, 'indice'))).data()?.['secciones'];
  const ids = Array.isArray(indice) ? indice.filter((x): x is string => typeof x === 'string') : [];
  for (const id of ids) {
    const v = validarSeccion((await tx.get(rutaSeccion(t, id))).data());
    if (v.ok && mediosDeSeccion(v.valor).includes(medioId)) return `la sección «${v.valor.titulo}»`;
  }
  return undefined;
}

interface CarruselConMedio {
  readonly plantilla: (typeof PLANTILLAS)[number];
  readonly doc: Readonly<Record<string, unknown>>;
  readonly items: readonly unknown[];
}

/** Carruseles guardados que contienen el medio: ya no bloquean el borrado; el servidor lo quita de ellos. */
async function carruselesConMedio(tx: TransaccionIdentidad, t: string, medioId: string): Promise<CarruselConMedio[]> {
  const out: CarruselConMedio[] = [];
  for (const plantilla of PLANTILLAS) {
    const doc = (await tx.get(rutaCarrusel(t, plantilla))).data();
    const items = doc?.['items'];
    if (doc !== undefined && Array.isArray(items) && items.some((i) => esObjeto(i) && i['medioId'] === medioId)) out.push({ plantilla, doc, items });
  }
  return out;
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
    // Las fotos de portada son del administrador, igual que su subida.
    if (m.productoId === ID_PORTADA && rol !== 'adm') throw new ErrorConsola('no-autorizado', 'No tiene permiso para esta acción');
    const sub = leerSubida((await tx.get(rutaSubida(t, e.medioId))).data());
    const uso = await leerUsoMedios(tx, t);
    const ficha = (await tx.get(rutaFicha(t, m.productoId))).data();
    const estado = await leerEstadoSitio(tx, t);
    const enUso = await medioEnSecciones(tx, t, e.medioId);
    const enCarruseles = await carruselesConMedio(tx, t, e.medioId);
    const versionPublicada = (await tx.get(rutaPublicado(t, 'estado'))).data()?.['version'];
    if (enCarruseles.length > 0 && rol !== 'adm') {
      throw new ErrorConsola('conflicto', 'Esta foto está en el carrusel de la portada; pídale al administrador que la quite');
    }
    if (enUso !== undefined) throw new ErrorConsola('conflicto', `${m.tipo === 'video' ? 'El video se usa' : 'La foto se usa'} en ${enUso}; ${m.tipo === 'video' ? 'quítelo' : 'quítela'} de ahí y guarde antes de borrarla`);

    const todas = [m.rutaOriginal, ...(m.versiones ?? []).map((v) => v.ruta)].filter((r): r is string => typeof r === 'string');
    // Con el sitio ya publicado, el sitio construido aún puede mostrar la copia pública: esa se borra cuando el sitio se
    // reconstruya con una versión posterior. El original privado y la cuota se liberan en el acto.
    const publico = `tenants/${t}/publico/`;
    const diferirPublicas = typeof versionPublicada === 'number';
    const rutas = diferirPublicas ? todas.filter((r) => !r.startsWith(publico)) : todas;
    const diferidas = diferirPublicas ? todas.filter((r) => r.startsWith(publico)) : [];
    escribirUsoMedios(tx, t, liberarEnUso(uso, m.productoId, m.tipo, m.bytesOriginal ?? 0));
    tx.delete(rutaMedio(t, e.medioId));
    const base: Subida = sub ?? {
      id: e.medioId, productoId: m.productoId, tipo: m.tipo, bytes: m.bytesOriginal ?? 0, estado: 'procesada',
      rutaOriginal: m.rutaOriginal ?? '', creadaEn: m.creadoEn ?? 0, venceEn: 0, por: e.actor.uid,
    };
    tx.set(rutaSubida(t, e.medioId), aDoc({
      ...base, estado: 'borrando', destino: 'eliminar', rutas,
      ...(diferidas.length === 0 ? {} : { rutasDiferidas: diferidas, borrarTrasVersion: versionPublicada as number, borrarTopeEn: deps.reloj.ahora() + TOPE_BORRADO_PUBLICO_MS, venceEn: deps.reloj.ahora() + LIMITES_CONSOLA.esperaBorradoLogoMs }),
    }));
    for (const c of enCarruseles) {
      const quedan = c.items.filter((i) => !(esObjeto(i) && i['medioId'] === e.medioId));
      tx.set(rutaCarrusel(t, c.plantilla), { ...c.doc, items: quedan });
      registrarAuditoria(tx, {
        tenantId: t, uid: e.actor.uid, rol, accion: 'carrusel.guardar', ruta: rutaCarrusel(t, c.plantilla), motivo: 'medio.borrar',
        resumenAntes: { items: c.items.length }, resumenDespues: { items: quedan.length },
      });
    }
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
    if (await borrarYCerrar(deps, t, id)) reintentadas += 1;
  }
  return { vencidas, reintentadas };
}

// ---------------------------------------------------------------------------------------------
// Logo del negocio (`sitio/logo`): un solo logo vigente, subido como archivo
// ---------------------------------------------------------------------------------------------

/** `sitio/logo`: referencia al medio vigente. `versiones[].ruta` es la ruta en Storage (relativa al bucket), pública bajo `publico/medios/_negocio/`. */
export interface LogoNegocio {
  readonly medioId: string;
  readonly ancho: number;
  readonly alto: number;
  readonly versiones: readonly { readonly formato: 'png' | 'webp'; readonly lado: number; readonly ruta: string; readonly bytes: number }[];
  readonly actualizadoEn: string;
}

function docLogo(m: MedioSubido): Record<string, unknown> {
  return {
    medioId: m.id, ancho: m.ancho, alto: m.alto,
    versiones: m.versiones.filter((v) => v.clase === 'logo').map((v) => ({ formato: v.formato, lado: v.lado, ruta: v.ruta, bytes: v.bytes })),
  };
}

function leerDocLogo(d: Readonly<Record<string, unknown>> | undefined): LogoNegocio | undefined {
  if (d === undefined) return undefined;
  const { medioId, ancho, alto, versiones, actualizadoEn } = d;
  if (typeof medioId !== 'string' || typeof ancho !== 'number' || typeof alto !== 'number' || !Array.isArray(versiones)) return undefined;
  const vs = versiones.filter(esObjeto).filter((v): v is Record<string, unknown> & { formato: 'png' | 'webp'; lado: number; ruta: string; bytes: number } =>
    (v['formato'] === 'png' || v['formato'] === 'webp') && typeof v['lado'] === 'number' && typeof v['ruta'] === 'string' && typeof v['bytes'] === 'number')
    .map((v) => ({ formato: v.formato, lado: v.lado, ruta: v.ruta, bytes: v.bytes }));
  return { medioId, ancho, alto, versiones: vs, actualizadoEn: typeof actualizadoEn === 'string' ? actualizadoEn : '' };
}

async function leerLogoEnTx(tx: TransaccionIdentidad, t: string): Promise<LogoNegocio | undefined> {
  return leerDocLogo((await tx.get(rutaSitio(t, 'logo'))).data());
}

export interface EntradaLogo {
  readonly tenantId: string;
  readonly actor: Actor;
}

/** Logo vigente del negocio, o `null` si no hay uno subido. Roles que ven Catálogo y sitio: sup y adm. */
export async function leerLogo(deps: Pick<DepsMedios, 'db'>, e: EntradaLogo): Promise<LogoNegocio | null> {
  const t = tenantValido(e.tenantId);
  exigirRol(e.actor, t, ROLES.consultar);
  return (leerDocLogo(await leerDoc(deps.db, rutaSitio(t, 'logo')))) ?? null;
}

/**
 * Quita el logo subido (solo `adm`): borra `sitio/logo`, su medio, el original y las versiones, y libera la cuota. No toca ninguna
 * URL de logo escrita a mano en otros módulos. Idempotente: sin logo devuelve `{ quitado: false }`.
 */
export async function quitarLogo(deps: DepsMedios, e: EntradaLogo): Promise<{ readonly quitado: boolean }> {
  const t = tenantValido(e.tenantId);
  const rol = exigirRol(e.actor, t, ROLES.administrar);
  const ahoraIso = new Date(deps.reloj.ahora()).toISOString();
  let agendar: number | null = null;
  const res = await deps.db.runTransaction(async (tx): Promise<{ readonly medioId: string | undefined } | undefined> => {
    agendar = null; // el cuerpo se reintenta
    const logo = await leerLogoEnTx(tx, t);
    if (logo === undefined) return undefined;
    const m = (await tx.get(rutaMedio(t, logo.medioId))).data() as Partial<MedioSubido> | undefined;
    const sub = leerSubida((await tx.get(rutaSubida(t, logo.medioId))).data());
    const uso = await leerUsoMedios(tx, t);
    const estado = await leerEstadoSitio(tx, t);
    const publicadoLogo = await leerPublicadoParaLogo(tx, t);
    const indiceDif = await leerIndiceDiferidas(tx, t);
    if (!esDelLogo(m, sub)) {
      // `sitio/logo` apunta a algo que no es un logo de `_negocio`: solo se quita la referencia (sin tocar medio, cuota ni subida).
      deps.avisar?.('logo: la referencia no apuntaba a un logo; solo se quitó la referencia', {});
      tx.delete(rutaSitio(t, 'logo'));
      const vivo = escribirLogoVivo(tx, t, publicadoLogo, undefined, deps.reloj);
      agendar = vivo.programar;
      if (!vivo.aplicado) anotarCambio(tx, t, estado, ahoraIso);
      registrarAuditoria(tx, { tenantId: t, uid: e.actor.uid, rol, accion: 'logo.quitar', ruta: rutaSitio(t, 'logo'), resumenAntes: { medioId: logo.medioId, bytes: 0 } });
      return { medioId: undefined };
    }
    const rutas = repartirRutasLogo(t, rutasPropiasDelLogo(deps, t, true,
      [m?.rutaOriginal, ...(m?.versiones ?? logo.versiones).map((v) => v.ruta)]), deps.reloj.ahora());
    const bytes = m?.bytesOriginal ?? 0;
    escribirUsoMedios(tx, t, liberarEnUso(uso, ID_NEGOCIO, 'logo', bytes));
    tx.delete(rutaSitio(t, 'logo'));
    if (m !== undefined) tx.delete(rutaMedio(t, logo.medioId));
    const base: Subida = sub ?? {
      id: logo.medioId, productoId: ID_NEGOCIO, tipo: 'logo', bytes, estado: 'procesada',
      rutaOriginal: m?.rutaOriginal ?? '', creadaEn: m?.creadoEn ?? 0, venceEn: 0, por: e.actor.uid,
    };
    tx.set(rutaSubida(t, logo.medioId), aDoc({ ...base, estado: 'borrando', destino: 'eliminar', ...rutas }));
    if (rutas.rutasDiferidas !== undefined) escribirIndiceDiferidas(tx, t, [...indiceDif, logo.medioId], deps.avisar);
    // Logo vivo: lo publicado deja de referir al logo en esta misma transacción; los archivos se borran después del commit.
    const vivo = escribirLogoVivo(tx, t, publicadoLogo, undefined, deps.reloj);
    agendar = vivo.programar;
    if (!vivo.aplicado) anotarCambio(tx, t, estado, ahoraIso);
    registrarAuditoria(tx, {
      tenantId: t, uid: e.actor.uid, rol, accion: 'logo.quitar', ruta: rutaSitio(t, 'logo'), resumenAntes: { medioId: logo.medioId, bytes },
    });
    return { medioId: logo.medioId };
  });
  if (res === undefined) return { quitado: false };
  await agendarLogoVivo(deps.disparador, t, agendar).catch(() => undefined);
  if (res.medioId !== undefined) await borrarYCerrar(deps, t, res.medioId);
  return { quitado: true };
}
