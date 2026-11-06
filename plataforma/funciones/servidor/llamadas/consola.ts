// Callable `consola`: catálogo web (productos, precios, fichas), secciones, carrusel, configuración del sitio,
// importación, publicación y tablero. Las acciones de usuarios (`listarUsuarios`, `buscarUsuarioPorCorreo`,
// `asignarRol`, `quitarRol`) son Central y viven en `usuarios.ts`; `index.ts` las compone en este mismo callable.
// La consola nunca escribe productos ni stock por su cuenta: crea y edita por Inventarios (puerto del catálogo)
// dentro de su propia transacción.
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  cambiarPrecioUSD, crearProductoConsola, editarProductoConsola, eliminarSeccion, exportarProductosCsv, guardarCarrusel,
  guardarConfigSitio, guardarFicha, guardarSeccion, importarProductos, obtenerTablero, ordenarSecciones, preciosDelDia, publicarSitio,
  simularImportacion, type DepsImportacion,
} from '@novutienda/consola';
import { leerCotizacion, SinCotizacionUtilizable, type CopiaCotizacion, type Mercado } from '@novutienda/nucleo';
import { accion, type Contexto, type TablaAcciones } from './marco.js';
import { ID_PRODUCTO, LIMITE, MS, OBJETO, UID, VACIO, objeto, validarRango } from './comunes.js';

const ADM = ['adm'] as const;
const SUPERVISION = ['sup', 'adm'] as const;

type DepsSitio = Parameters<typeof guardarFicha>[0];
const datosDe = (d: { data(): unknown }): Record<string, unknown> => d.data() as Record<string, unknown>;
const reloj = (c: Contexto): { ahora(): number } => ({ ahora: c.e.ahora });
const depsSitio = (c: Contexto): DepsSitio => ({ db: c.e.db, catalogo: c.e.catalogo, reloj: reloj(c) });
const depsImportacion = (c: Contexto): DepsImportacion => ({ db: c.e.db, catalogo: c.e.catalogo, reloj: reloj(c) });
const ruta = (t: string, col: string, id?: string): string => `tenants/${t}/${col}${id === undefined ? '' : `/${id}`}`;

const MAX_BYTES_ARCHIVO = 2 * 1024 * 1024;

/** Decodifica base64 estricto con tope de bytes (el archivo llega dentro del JSON). */
function base64(valor: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(valor) || valor.length % 4 !== 0) throw new HttpsError('invalid-argument', 'El archivo debe venir en base64.');
  const bytes = Buffer.from(valor, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_BYTES_ARCHIVO) throw new HttpsError('invalid-argument', 'El archivo está vacío o supera 2 MB.');
  return new Uint8Array(bytes);
}

export const accionesConsola: TablaAcciones = {
  // ---- Productos y precios ---------------------------------------------------------------------------------
  crearProducto: accion({
    roles: ADM,
    esquema: objeto({ productoId: ID_PRODUCTO, datos: OBJETO, precioUSD: OBJETO }),
    ejecutar: async (c, d) => {
      await crearProductoConsola({ db: c.e.db, catalogo: c.e.catalogo, reloj: reloj(c) }, { tenantId: c.tenantId, actor: c.actor, productoId: d.productoId, datos: d.datos, precioUSD: d.precioUSD });
      return { productoId: d.productoId };
    },
  }),
  editarProducto: accion({
    roles: ADM,
    esquema: objeto({ productoId: ID_PRODUCTO, cambios: OBJETO }),
    ejecutar: async (c, d) => {
      await editarProductoConsola({ db: c.e.db, catalogo: c.e.catalogo, reloj: reloj(c) }, { tenantId: c.tenantId, actor: c.actor, productoId: d.productoId, cambios: d.cambios });
      return { productoId: d.productoId };
    },
  }),
  cambiarPrecioUSD: accion({
    roles: ADM,
    esquema: objeto({ productoId: ID_PRODUCTO, precioUSD: OBJETO }),
    ejecutar: async (c, d) => {
      await cambiarPrecioUSD({ db: c.e.db, catalogo: c.e.catalogo, reloj: reloj(c) }, { tenantId: c.tenantId, actor: c.actor, productoId: d.productoId, precioUSD: d.precioUSD });
      return { productoId: d.productoId };
    },
  }),
  catalogo: accion({
    roles: SUPERVISION,
    esquema: VACIO,
    ejecutar: async (c) => ({ productos: await c.e.catalogo.listarProductos(c.tenantId) }),
  }),
  /** Precio en Bs y en ARS del día para un precio base en USD (editor de ficha), con el redondeo del tenant. */
  preciosDelDia: accion({
    roles: SUPERVISION,
    esquema: objeto({ precioUSD: objeto({ bo: z.number().nonnegative().max(9_999_999), ar: z.number().nonnegative().max(9_999_999) }) }),
    ejecutar: async (c, d) => {
      const cotizaciones: Partial<Record<Mercado, CopiaCotizacion>> = {};
      for (const m of ['BO', 'AR'] as const) {
        try {
          cotizaciones[m] = await leerCotizacion(c.e.almacenCotizaciones, m, c.e.ahora(), { tenantId: c.tenantId });
        } catch (error) {
          if (!(error instanceof SinCotizacionUtilizable)) throw error;
        }
      }
      return preciosDelDia(d.precioUSD, cotizaciones, await c.e.redondeo(c.tenantId));
    },
  }),

  // ---- Fichas, secciones, carrusel y configuración del sitio -----------------------------------------------
  guardarFicha: accion({
    roles: SUPERVISION,
    esquema: objeto({ productoId: ID_PRODUCTO, ficha: OBJETO }),
    ejecutar: async (c, d) => {
      await guardarFicha(depsSitio(c), { tenantId: c.tenantId, actor: c.actor, productoId: d.productoId, ficha: d.ficha });
      return { productoId: d.productoId };
    },
  }),
  leerFicha: accion({
    roles: SUPERVISION,
    esquema: objeto({ productoId: ID_PRODUCTO }),
    ejecutar: async (c, d) => ({ ficha: (await c.e.firestore.doc(ruta(c.tenantId, 'fichasWeb', d.productoId)).get()).data() ?? null }),
  }),
  guardarSeccion: accion({
    roles: ADM,
    esquema: objeto({ seccion: OBJETO }),
    ejecutar: async (c, d) => {
      await guardarSeccion(depsSitio(c), { tenantId: c.tenantId, actor: c.actor, seccion: d.seccion });
      return { ok: true };
    },
  }),
  eliminarSeccion: accion({
    roles: ADM,
    esquema: objeto({ seccionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,29}$/) }),
    ejecutar: async (c, d) => {
      await eliminarSeccion(depsSitio(c), { tenantId: c.tenantId, actor: c.actor, seccionId: d.seccionId });
      return { ok: true };
    },
  }),
  ordenarSecciones: accion({
    roles: ADM,
    esquema: objeto({ orden: z.array(z.string().max(30)).max(5) }),
    ejecutar: async (c, d) => {
      await ordenarSecciones(depsSitio(c), { tenantId: c.tenantId, actor: c.actor, orden: d.orden });
      return { ok: true };
    },
  }),
  guardarCarrusel: accion({
    roles: ADM,
    esquema: objeto({ carrusel: OBJETO }),
    ejecutar: async (c, d) => {
      await guardarCarrusel(depsSitio(c), { tenantId: c.tenantId, actor: c.actor, carrusel: d.carrusel });
      return { ok: true };
    },
  }),
  guardarConfigSitio: accion({
    roles: ADM,
    esquema: objeto({ config: OBJETO }),
    ejecutar: async (c, d) => {
      await guardarConfigSitio(depsSitio(c), { tenantId: c.tenantId, actor: c.actor, config: d.config });
      return { ok: true };
    },
  }),

  /** Lecturas del sitio (solo lectura; el navegador no las lee directo por la CSP del panel). */
  fichas: accion({
    roles: SUPERVISION,
    esquema: VACIO,
    ejecutar: async (c) => ({
      fichas: (await c.e.firestore.collection(ruta(c.tenantId, 'fichasWeb')).limit(500).get()).docs.map((f) => ({ productoId: f.id, ficha: datosDe(f) })),
    }),
  }),
  /** Secciones en el orden del índice del sitio (las que no estén en el índice van al final). */
  secciones: accion({
    roles: SUPERVISION,
    esquema: VACIO,
    ejecutar: async (c) => {
      const [docs, indice] = await Promise.all([
        c.e.firestore.collection(ruta(c.tenantId, 'secciones')).limit(50).get(),
        c.e.firestore.doc(ruta(c.tenantId, 'sitio', 'indice')).get(),
      ]);
      const orden = ((indice.data()?.['secciones'] as unknown[] | undefined) ?? []).filter((x): x is string => typeof x === 'string');
      const posicion = (id: string): number => { const i = orden.indexOf(id); return i < 0 ? orden.length : i; };
      return { secciones: docs.docs.map((x) => ({ id: x.id, ...datosDe(x) })).sort((a, b) => posicion(a.id) - posicion(b.id)) };
    },
  }),
  carruseles: accion({
    roles: SUPERVISION,
    esquema: VACIO,
    ejecutar: async (c) => ({ carruseles: (await c.e.firestore.collection(ruta(c.tenantId, 'carruseles')).limit(50).get()).docs.map((x) => ({ plantilla: x.id, ...datosDe(x) })) }),
  }),
  /** Configuración del sitio, o `null` si aún no se guardó. */
  configSitio: accion({
    roles: SUPERVISION,
    esquema: VACIO,
    ejecutar: async (c) => ({ config: (await c.e.firestore.doc(ruta(c.tenantId, 'sitio', 'config')).get()).data() ?? null }),
  }),

  // ---- Importación y exportación (CSV; .xlsx no está disponible: ver docs/produccion) ----------------------
  simularImportacion: accion({
    roles: ADM,
    maxCaracteres: 3_000_000,
    esquema: objeto({ archivo: z.string().min(4).max(2_900_000) }),
    ejecutar: async (c, d) => ({ simulacion: await simularImportacion({ catalogo: c.e.catalogo }, { tenantId: c.tenantId, actor: c.actor, contenido: base64(d.archivo) }) }),
  }),
  importarProductos: accion({
    roles: ADM,
    maxCaracteres: 3_000_000,
    esquema: objeto({ archivo: z.string().min(4).max(2_900_000), omitirErrores: z.boolean().optional() }),
    ejecutar: async (c, d) =>
      importarProductos(depsImportacion(c), { tenantId: c.tenantId, actor: c.actor, contenido: base64(d.archivo), ...(d.omitirErrores !== undefined ? { omitirErrores: d.omitirErrores } : {}) }),
  }),
  exportarProductosCsv: accion({
    roles: SUPERVISION,
    esquema: VACIO,
    ejecutar: async (c) => ({ csv: exportarProductosCsv(await c.e.catalogo.listarProductos(c.tenantId)) }),
  }),

  // ---- Publicación y tablero ------------------------------------------------------------------------------
  publicarSitio: accion({
    roles: ADM,
    esquema: VACIO,
    ejecutar: (c) => publicarSitio({ db: c.e.db, catalogo: c.e.catalogo, reloj: reloj(c), disparador: c.e.disparadorSitio }, { tenantId: c.tenantId, actor: c.actor }),
  }),
  tablero: accion({
    roles: SUPERVISION,
    esquema: VACIO,
    ejecutar: (c) => obtenerTablero({ db: c.e.db, cotizaciones: c.e.almacenCotizaciones, reloj: reloj(c) }, { tenantId: c.tenantId, actor: c.actor }),
  }),
  alertas: accion({
    roles: SUPERVISION,
    esquema: objeto({ limite: LIMITE.optional() }),
    ejecutar: async (c, d) => ({
      alertas: (await c.e.firestore.collection(ruta(c.tenantId, 'alertas')).orderBy('creadaEn', 'desc').limit(d.limite ?? 30).get()).docs.map((a) => ({ id: a.id, ...a.data() })),
    }),
  }),

  /**
   * Auditoría del tenant (`sup`/`adm`), de la más reciente a la más antigua. Devuelve solo los campos de la vista (sin los
   * resúmenes antes/después). Rango por `en`; los filtros `accion` y `uid` se aplican sobre una ventana de las últimas
   * 1000 entradas del rango, para no exigir índices compuestos nuevos.
   */
  auditoria: accion({
    roles: SUPERVISION,
    esquema: objeto({ desde: MS.optional(), hasta: MS.optional(), accion: z.string().min(1).max(60).optional(), uid: UID.optional(), limite: LIMITE.optional() }),
    ejecutar: async (c, d) => {
      validarRango(d.desde, d.hasta);
      const limite = d.limite ?? 100;
      let q = c.e.firestore.collection(ruta(c.tenantId, 'auditoria')).orderBy('en', 'desc');
      if (d.desde !== undefined) q = q.where('en', '>=', new Date(d.desde));
      if (d.hasta !== undefined) q = q.where('en', '<=', new Date(d.hasta));
      const filtra = d.accion !== undefined || d.uid !== undefined;
      const entradas = (await q.limit(filtra ? 1000 : limite).get()).docs
        .filter((e) => (d.accion === undefined || e.data()['accion'] === d.accion) && (d.uid === undefined || e.data()['uid'] === d.uid))
        .slice(0, limite)
        .map((e) => {
          const x = datosDe(e);
          const en = x['en'] as { toDate?: () => Date } | undefined;
          return {
            id: e.id, fecha: typeof en?.toDate === 'function' ? en.toDate().toISOString() : '', uid: x['uid'], rol: x['rol'], accion: x['accion'], ruta: x['ruta'],
            ...(typeof x['motivo'] === 'string' ? { motivo: x['motivo'] } : {}),
          };
        });
      return { entradas };
    },
  }),
};

