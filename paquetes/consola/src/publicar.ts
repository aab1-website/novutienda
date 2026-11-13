import { registrarAuditoria, type Actor } from '@novutienda/nucleo';
import { leerEstadoSitio } from './cambios.js';
import { ErrorConsola } from './errores.js';
import type { FichaWeb } from './fichas.js';
import { LIMITES_CONSOLA } from './limites.js';
import type { Medio } from './medios/subidas.js';
import { exigirRol, ROLES } from './permisos.js';
import { PLANTILLAS } from './plantillas.js';
import type {
  BaseDatosConsola, CatalogoPuerto, DisparadorSitio, PrecioUSD, ProductoCatalogo, Reloj,
} from './puertos.js';
import { rutaCarrusel, rutaFicha, rutaMedio, rutaPublicado, rutaSeccion, rutaSitio, tenantValido } from './rutas.js';
import type { Bloque, Seccion } from './secciones.js';
import type { Carrusel, ConfigSitio } from './sitio.js';
import { validarSeccion } from './secciones.js';
import { validarCarrusel, validarConfigSitio } from './sitio.js';
import { esObjeto } from './validar.js';

// ---------------------------------------------------------------------------------------------
// Disponibilidad pública (solo disponible / agotado, sin cantidades)
// ---------------------------------------------------------------------------------------------

/**
 * Proyección pública de disponibilidad. NO define la regla: usa `disponible`, que el catálogo (Inventarios) calcula con su
 * regla única (activo y existencia en `tienda` > 0; ver `esDisponible` de Inventarios). Así la web y `existenciasPublicas`
 * nunca discrepan. Nunca se publican cantidades.
 */
export function proyectarDisponibilidad(
  productos: readonly Pick<ProductoCatalogo, 'id' | 'disponible'>[],
): Readonly<Record<string, { readonly disponible: boolean }>> {
  const salida: Record<string, { disponible: boolean }> = {};
  for (const p of productos) salida[p.id] = { disponible: p.disponible };
  return salida;
}

/** Arma la proyección leyendo el catálogo por el puerto (solo lectura). */
export async function calcularDisponibilidadPublica(catalogo: CatalogoPuerto, tenantId: string) {
  return proyectarDisponibilidad(await catalogo.listarProductos(tenantId));
}

// ---------------------------------------------------------------------------------------------
// Decisión de reconstrucción (agrupa cambios 10 minutos)
// ---------------------------------------------------------------------------------------------

export type EventoReconstruccion = 'publicacion' | 'temporizador' | 'diaria';

export type DecisionReconstruccion =
  | { readonly accion: 'nada' }
  /** Primer cambio del grupo: agendar la reconstrucción para `para`. */
  | { readonly accion: 'programar'; readonly para: number }
  /** Ya hay una agendada: el cambio se suma al grupo. */
  | { readonly accion: 'esperar'; readonly para: number }
  | { readonly accion: 'reconstruir' };

/**
 * Función pura. `programadaPara` es la reconstrucción ya agendada (ms) o null. Una publicación agenda a +10 min si no
 * hay nada agendado y, si ya hay (vencida o no), se agrupa y espera al temporizador. El temporizador reconstruye solo cuando llegó la hora. La corrida diaria
 * (tras la publicación del BCB) reconstruye siempre que haya algo publicado.
 */
export function decidirReconstruccion(
  estado: { readonly hayPublicacion: boolean; readonly programadaPara: number | null },
  ahora: number,
  evento: EventoReconstruccion,
  ventanaMs: number = LIMITES_CONSOLA.ventanaReconstruccionMs,
): DecisionReconstruccion {
  if (evento === 'diaria') return estado.hayPublicacion ? { accion: 'reconstruir' } : { accion: 'nada' };
  const p = estado.programadaPara;
  if (p === null) return evento === 'publicacion' ? { accion: 'programar', para: ahora + ventanaMs } : { accion: 'nada' };
  // Una publicación o un cambio que llega con la hora ya vencida NO reconstruye: espera al temporizador, que es el único punto
  // que pasa a `reconstruir` (así un solo lugar avisa a quien reconstruye el sitio).
  if (evento === 'publicacion') return { accion: 'esperar', para: p };
  return p > ahora ? { accion: 'esperar', para: p } : { accion: 'reconstruir' };
}

// ---------------------------------------------------------------------------------------------
// Copia publicada (`publicado/`)
// ---------------------------------------------------------------------------------------------

export interface MedioPublico {
  readonly tipo: 'foto' | 'video';
  readonly alt: string;
  readonly ancho: number;
  readonly alto: number;
  readonly versiones: readonly { readonly clase: 'imagen' | 'video' | 'poster'; readonly lado: number; readonly formato: string; readonly ruta: string }[];
}

export interface ProductoPublicado {
  readonly id: string;
  readonly slug: string;
  readonly nombre: string;
  readonly categoria: string;
  readonly marca?: string;
  readonly descripcion: string;
  readonly garantia: string;
  readonly garantiaMeses?: number;
  readonly medios: readonly MedioPublico[];
  readonly seo: FichaWeb['seo'];
  /** Precio base en USD por mercado; el sitio lo convierte con `precioFinal` y la cotización. */
  readonly precioUSD: PrecioUSD;
}

export type BloquePublicado =
  | Exclude<Bloque, { tipo: 'imagen' | 'carrusel' }>
  | { readonly tipo: 'imagen'; readonly medio: MedioPublico }
  | { readonly tipo: 'carrusel'; readonly items: readonly MedioPublico[] };

export interface SeccionPublicada {
  readonly id: string;
  readonly titulo: string;
  readonly bloques: readonly BloquePublicado[];
}

export interface CarruselPublicado {
  readonly plantilla: string;
  readonly items: readonly (MedioPublico & { readonly enlace?: string })[];
}

export interface FichaGuardada extends FichaWeb {
  readonly productoId: string;
}

export interface EntradaPublicado {
  readonly productos: readonly ProductoCatalogo[];
  readonly fichas: ReadonlyMap<string, FichaGuardada>;
  readonly medios: ReadonlyMap<string, Medio>;
  readonly config: ConfigSitio;
  /** En el orden del menú. */
  readonly secciones: readonly Seccion[];
  readonly carruseles: readonly Carrusel[];
}

export interface Publicado {
  readonly config: ConfigSitio;
  readonly productos: readonly ProductoPublicado[];
  readonly secciones: readonly SeccionPublicada[];
  readonly carruseles: readonly CarruselPublicado[];
  readonly advertencias: readonly string[];
}

/** Foto utilizable por el sitio: medio de tipo foto con versión `imagen` en webp. Una sola noción para toda la consola. */
const tieneFoto = (m: MedioPublico): boolean => m.tipo === 'foto' && m.versiones.some((v) => v.clase === 'imagen' && v.formato === 'webp');

/**
 * Función pura: arma lo que la reconstrucción del sitio lee. Entran solo fichas en estado `publicado` de
 * productos activos; salen únicamente datos públicos (sin stock, costos, SKU, rutas de originales ni autores).
 */
export function construirPublicado(e: EntradaPublicado): Publicado {
  const advertencias: string[] = [];
  const publico = (medioId: string, alt: string, donde: string): MedioPublico | undefined => {
    const m = e.medios.get(medioId);
    if (m === undefined) {
      advertencias.push(`${donde}: el medio ${medioId} no existe y se omitió`);
      return undefined;
    }
    return {
      tipo: m.tipo, alt, ancho: m.ancho, alto: m.alto,
      versiones: m.versiones.map((v) => ({ clase: v.clase, lado: v.lado, formato: v.formato, ruta: v.ruta })),
    };
  };
  const sinNulos = <T>(xs: readonly (T | undefined)[]): T[] => xs.filter((x): x is T => x !== undefined);

  const productos: ProductoPublicado[] = [];
  for (const p of [...e.productos].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const f = e.fichas.get(p.id);
    if (f?.estado !== 'publicado' || !p.activo) continue;
    // El sitio exige marca; un dato viejo sin marca se excluye (no tumba la publicación) y se avisa al comerciante.
    if ((p.marca ?? '').trim() === '') {
      advertencias.push(`El producto «${p.nombre}» no se publicó porque no tiene marca; agréguela en Inventario y vuelva a publicar`);
      continue;
    }
    productos.push({
      id: p.id, slug: f.slug, nombre: p.nombre, categoria: p.categoria,
      marca: p.marca!,
      descripcion: f.descripcion, garantia: f.garantia,
      ...(p.garantiaMeses === undefined ? {} : { garantiaMeses: p.garantiaMeses }),
      medios: sinNulos(f.medios.map((m) => publico(m.medioId, m.alt, `producto ${p.id}`))),
      seo: f.seo, precioUSD: p.precioUSD,
    });
  }

  const secciones: SeccionPublicada[] = e.secciones.filter((s) => s.visible).map((s) => ({
    id: s.id, titulo: s.titulo,
    bloques: sinNulos(s.bloques.map((b): BloquePublicado | undefined => {
      if (b.tipo === 'imagen') {
        const m = publico(b.medioId, b.alt, `sección ${s.id}`);
        return m === undefined ? undefined : { tipo: 'imagen', medio: m };
      }
      if (b.tipo === 'carrusel') {
        const items = sinNulos(b.items.map((i) => publico(i.medioId, i.alt, `sección ${s.id}`))).filter(tieneFoto);
        if (items.length === 0) {
          advertencias.push(`La sección «${s.titulo}» tenía un carrusel sin fotos disponibles y se omitió`);
          return undefined;
        }
        return { tipo: 'carrusel', items };
      }
      return b;
    })),
  })).filter((s) => {
    // El sitio exige de 1 a 12 bloques por sección visible: toda sección que salga sin bloques (vacía de origen o tras omitir
    // los que no tienen contenido publicable) se omite entera con una advertencia.
    if (s.bloques.length > 0) return true;
    advertencias.push(`La sección «${s.titulo}» no se publicó porque no tiene contenido`);
    return false;
  });

  const carruseles: CarruselPublicado[] = e.carruseles.map((c) => ({
    plantilla: c.plantilla,
    items: sinNulos(c.items.map((i) => {
      const m = publico(i.medioId, i.alt, `carrusel ${c.plantilla}`);
      return m === undefined ? undefined : i.enlace === undefined ? m : { ...m, enlace: i.enlace };
    })),
  }));

  return { config: e.config, productos, secciones, carruseles, advertencias };
}

// ---------------------------------------------------------------------------------------------
// Publicar
// ---------------------------------------------------------------------------------------------

export interface DepsPublicar {
  readonly db: BaseDatosConsola;
  readonly catalogo: CatalogoPuerto;
  readonly reloj: Reloj;
  readonly disparador: DisparadorSitio;
}

export interface ResultadoPublicacion {
  readonly version: number;
  readonly productos: number;
  readonly decision: DecisionReconstruccion;
  readonly advertencias: readonly string[];
}

const texto = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []);

const leerReconstruccion = (d: Readonly<Record<string, unknown>> | undefined): { version: number; programadaPara: number | null; productos: string[]; secciones: string[]; carruseles: string[] } => {
  const r = d?.['reconstruccion'];
  const p = esObjeto(r) ? r['programadaPara'] : null;
  return {
    version: typeof d?.['version'] === 'number' ? d['version'] : 0,
    programadaPara: typeof p === 'number' ? p : null,
    productos: texto(d?.['productos']), secciones: texto(d?.['secciones']), carruseles: texto(d?.['carruseles']),
  };
};

/**
 * Lo que haría fallar la reconstrucción del sitio se rechaza ANTES de escribir nada:
 *  - sin productos publicables, el sitio no se reconstruye;
 *  - el sitio exige de 1 a 8 fotos en el carrusel de CADA plantilla. Si la plantilla no tiene carrusel propio con fotos, el sitio usa
 *    de respaldo la primera foto de los productos (destacados primero, o todos si no hay destacados con foto; los destacados son del
 *    negocio y siempre son un subconjunto de los productos con foto). Por tanto el respaldo queda vacío si y solo si ningún producto
 *    publicado tiene una foto utilizable (medio de tipo foto con versión webp de imagen; ver `foto` en
 *    `website/src/contenido/desde-publicado.ts`). Si además alguna plantilla no tiene carrusel propio, el sitio falla.
 *    Podría compartirse por el núcleo más adelante (hoy está duplicada a propósito: las fronteras impiden importar website).
 */
function exigirPublicable(pub: Publicado, candidatos: number, sinMarca: number): void {
  const motivo = motivoNoPublicable(pub);
  if (motivo === 'sin_productos') {
    if (candidatos > 0 && sinMarca === candidatos) {
      throw new ErrorConsola('estado', 'Ningún producto se puede publicar: agregue la marca en Inventario a los productos publicados');
    }
    throw new ErrorConsola('estado', 'Publique al menos un producto activo');
  }
  if (motivo === 'sin_fotos') throw new ErrorConsola('estado', 'Agregue una foto a un producto publicado o cargue el carrusel');
}

export type MotivoSitioIncompleto = 'sin_productos' | 'sin_fotos';

/**
 * Función pura: la comprobación de `exigirPublicable` sin lanzar. Devuelve por qué un conjunto publicado quedaría sin productos o
 * sin fotos, o `null` si es publicable. La usan `publicarSitio` (que rechaza) y el retiro automático por producto desactivado
 * (que solo avisa: el sitio admite quedar sin catálogo o sin fotos). Solo mira productos y carruseles, que existen igual en la
 * copia `publicado/`.
 */
export function motivoNoPublicable(
  pub: {
    readonly productos: readonly { readonly medios: readonly MedioPublico[] }[];
    readonly carruseles: readonly { readonly plantilla: string; readonly items: readonly MedioPublico[] }[];
  },
): MotivoSitioIncompleto | null {
  if (pub.productos.length === 0) return 'sin_productos';
  if (pub.productos.some((p) => p.medios.some(tieneFoto))) return null;
  const propio = (pl: string): boolean => pub.carruseles.some((c) => c.plantilla === pl && c.items.some(tieneFoto));
  return PLANTILLAS.some((pl) => !propio(pl)) ? 'sin_fotos' : null;
}

/**
 * Publica: escribe la copia `publicado/` (una sola transacción), pone a cero los cambios sin publicar, registra la
 * auditoría y agenda la reconstrucción (agrupa 10 minutos). Solo adm.
 */
export async function publicarSitio(deps: DepsPublicar, e: { tenantId: string; actor: Actor }): Promise<ResultadoPublicacion> {
  const t = tenantValido(e.tenantId);
  const rol = exigirRol(e.actor, t, ROLES.administrar);
  const r = await deps.db.runTransaction(async (tx) => {
    // La lista se lee DENTRO del cuerpo que se reintenta (no es lectura transaccional): cada intento parte de la lista vigente, así un
    // producto nuevo con ficha publicada entre intentos no se pierde. Corte: instante ANTERIOR a la lectura de la lista de ESTE
    // intento. Todo cambio con `ocurridoEn` <= corte ya está en `productos`; uno posterior (aunque la lectura lo haya visto) se
    // cuenta de más, nunca se pierde.
    const corteIso = new Date(deps.reloj.ahora()).toISOString();
    const productos = await deps.catalogo.listarProductos(t);
    const ahora = deps.reloj.ahora();
    const ahoraIso = new Date(ahora).toISOString();
    const config = validarConfigSitio((await tx.get(rutaSitio(t, 'config'))).data());
    if (!config.ok) throw new ErrorConsola('estado', 'Configure el sitio (plantilla y WhatsApp) antes de publicar', config.errores);
    const indice = texto((await tx.get(rutaSitio(t, 'indice'))).data()?.['secciones']);
    const secciones: Seccion[] = [];
    for (const id of indice) {
      const s = validarSeccion((await tx.get(rutaSeccion(t, id))).data());
      if (s.ok) secciones.push(s.valor);
    }
    const carruseles: Carrusel[] = [];
    for (const p of PLANTILLAS) {
      const d = (await tx.get(rutaCarrusel(t, p))).data();
      if (d === undefined) continue;
      const c = validarCarrusel(d);
      if (c.ok) carruseles.push(c.valor);
    }
    const fichas = new Map<string, FichaGuardada>();
    for (const p of productos) {
      const d = (await tx.get(rutaFicha(t, p.id))).data();
      if (d !== undefined) fichas.set(p.id, d as unknown as FichaGuardada);
    }
    // Relectura de cada producto a publicar DENTRO de la transacción: precio, activo, marca, nombre y categoría salen SOLO de aquí, no de
    // la lista previa (un cambio entre la lectura y el commit no se pisa; si ocurre durante la transacción, se reintenta). Una lectura
    // por producto con ficha publicada (hasta 200 por plan, más sus fichas y medios): lejos de cualquier tope de la transacción, y las
    // escrituras (un documento por producto, sección o carrusel más 4 fijos) quedan por debajo de las 500 de Firestore.
    // Contención con las ventas: Inventarios escribe el documento del producto en cada movimiento, así que una publicación concurrente
    // con ventas puede esperar o reintentar (la transacción lo hace sola); las ventas no se bloquean más allá de ese conflicto.
    const vivos: ProductoCatalogo[] = [];
    for (const p of productos) {
      if (fichas.get(p.id)?.estado !== 'publicado') continue;
      const f = await deps.catalogo.leerProductoEnTransaccion(tx, t, p.id);
      if (f === undefined) continue;
      const garantiaMeses = f.garantiaMeses ?? p.garantiaMeses;
      vivos.push({
        id: p.id, disponible: p.disponible, nombre: f.nombre, categoria: f.categoria, activo: f.activo, precioUSD: f.precioUSD,
        ...(f.marca === undefined ? {} : { marca: f.marca }),
        ...(garantiaMeses === undefined ? {} : { garantiaMeses }),
      });
    }
    const candidatos = vivos.filter((p) => fichas.get(p.id)?.estado === 'publicado' && p.activo);
    const sinMarca = candidatos.filter((p) => (p.marca ?? '').trim() === '').length;
    const ids = new Set<string>();
    for (const f of fichas.values()) if (f.estado === 'publicado') for (const m of f.medios) ids.add(m.medioId);
    for (const s of secciones) for (const b of s.bloques) {
      if (b.tipo === 'imagen') ids.add(b.medioId);
      if (b.tipo === 'carrusel') for (const i of b.items) ids.add(i.medioId);
    }
    for (const c of carruseles) for (const i of c.items) ids.add(i.medioId);
    const medios = new Map<string, Medio>();
    for (const id of ids) {
      const d = (await tx.get(rutaMedio(t, id))).data();
      if (d !== undefined) medios.set(id, d as unknown as Medio);
    }
    const previo = leerReconstruccion((await tx.get(rutaPublicado(t, 'estado'))).data());
    await leerEstadoSitio(tx, t);

    const pub = construirPublicado({ productos: vivos, fichas, medios, config: config.valor, secciones, carruseles });
    exigirPublicable(pub, candidatos.length, sinMarca);
    const version = previo.version + 1;
    const decision = decidirReconstruccion({ hayPublicacion: true, programadaPara: previo.programadaPara }, ahora, 'publicacion');

    for (const p of pub.productos) tx.set(rutaPublicado(t, `producto__${p.id}`), { ...p });
    for (const s of pub.secciones) tx.set(rutaPublicado(t, `seccion__${s.id}`), { ...s });
    for (const c of pub.carruseles) tx.set(rutaPublicado(t, `carrusel__${c.plantilla}`), { ...c });
    tx.set(rutaPublicado(t, 'sitio'), { ...pub.config, version });
    const idsProd = pub.productos.map((p) => p.id);
    const idsSec = pub.secciones.map((s) => s.id);
    const idsCar = pub.carruseles.map((c) => c.plantilla);
    for (const id of previo.productos) if (!idsProd.includes(id)) tx.delete(rutaPublicado(t, `producto__${id}`));
    for (const id of previo.secciones) if (!idsSec.includes(id)) tx.delete(rutaPublicado(t, `seccion__${id}`));
    for (const id of previo.carruseles) if (!idsCar.includes(id)) tx.delete(rutaPublicado(t, `carrusel__${id}`));

    const programadaPara = decision.accion === 'programar' ? decision.para : decision.accion === 'esperar' ? decision.para : null;
    tx.set(rutaPublicado(t, 'estado'), {
      version, publicadoEn: ahoraIso, productos: idsProd, secciones: idsSec, carruseles: idsCar,
      reconstruccion: { programadaPara, ultima: null },
    });
    // Poner `sitio/estado` de nuevo limpia también `avisoSitio`: una publicación correcta deja el conjunto publicable.
    tx.set(rutaSitio(t, 'estado'), { cambios: 0, ultimoCambioEn: ahoraIso, corteCatalogoEn: corteIso });
    registrarAuditoria(tx, {
      tenantId: t, uid: e.actor.uid, rol, accion: 'sitio.publicar', ruta: rutaPublicado(t, 'estado'),
      resumenDespues: { version, productos: idsProd.length, secciones: idsSec.length },
    });
    return { version, productos: idsProd.length, decision, advertencias: pub.advertencias };
  });

  // Con el evento `publicacion` la decisión es solo `programar` o `esperar`: reconstruir es siempre cosa del temporizador.
  if (r.decision.accion === 'programar') await deps.disparador.programar(t, r.decision.para);
  return r;
}

/**
 * Lo invocan el temporizador agendado (`temporizador`) y la corrida diaria tras la publicación del BCB (`diaria`).
 * Corre en el servidor; no depende de ninguna máquina de usuario.
 */
export async function ejecutarReconstruccion(
  deps: Pick<DepsPublicar, 'db' | 'reloj' | 'disparador'>, e: { tenantId: string; evento: 'temporizador' | 'diaria' },
): Promise<DecisionReconstruccion> {
  const t = tenantValido(e.tenantId);
  const ahora = deps.reloj.ahora();
  const { decision, version, programadaPara } = await deps.db.runTransaction(async (tx) => {
    const d = (await tx.get(rutaPublicado(t, 'estado'))).data();
    const prev = leerReconstruccion(d);
    const dec = decidirReconstruccion({ hayPublicacion: d !== undefined, programadaPara: prev.programadaPara }, ahora, e.evento);
    return { decision: dec, version: prev.version, programadaPara: prev.programadaPara };
  });
  if (decision.accion !== 'reconstruir') return decision;
  // Primero se dispara y SOLO después se limpia lo agendado: si `reconstruir` falla, `programadaPara` sigue vencida y el siguiente
  // tic del temporizador lo reintenta (el disparador real es idempotente por motivo, versión y minuto: no duplica trabajos).
  await deps.disparador.reconstruir(t, version, e.evento === 'diaria' ? 'diaria' : 'publicacion');
  await deps.db.runTransaction(async (tx) => {
    const d = (await tx.get(rutaPublicado(t, 'estado'))).data();
    if (d === undefined) return;
    const actual = leerReconstruccion(d);
    // Si entretanto se agendó otra hora distinta (otro grupo de cambios), se respeta.
    tx.set(rutaPublicado(t, 'estado'), {
      ...d, reconstruccion: { programadaPara: actual.programadaPara === programadaPara ? null : actual.programadaPara, ultima: ahora },
    });
  });
  return decision;
}
