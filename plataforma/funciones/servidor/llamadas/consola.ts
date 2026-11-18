// Callable `consola`: catálogo web (productos, precios, fichas), secciones, carrusel, configuración del sitio,
// exportación, publicación y tablero. Las acciones de usuarios (`listarUsuarios`, `buscarUsuarioPorCorreo`,
// `asignarRol`, `quitarRol`) son Central y viven en `usuarios.ts`; `index.ts` las compone en este mismo callable.
// La consola no crea ni edita productos ni escribe stock: eso es de Inventarios (`inventarios.crearProducto`, etc.).
import { z } from 'zod';
import {
  eliminarSeccion, guardarCarrusel, guardarConfigSitio, guardarFicha, guardarSeccion, obtenerTablero,
  guardarNegocioSitio, leerLogo, leerNegocioSitio, ordenarSecciones, preciosDelDiaDe, publicarSitio, quitarLogo,
} from '@novutienda/consola';
import { claveDePrecio, leerCotizacionDe, MAX_MERCADOS, SinCotizacionUtilizable, type CopiaCotizacion } from '@novutienda/nucleo';
import { HttpsError } from 'firebase-functions/v2/https';
import { depsMedios } from './medios.js';
import { accion, type Contexto, type TablaImplementaciones } from './marco.js';
import { ID_PRODUCTO, LIMITE, MS, OBJETO, UID, VACIO, objeto, validarRango } from './comunes.js';


type DepsSitio = Parameters<typeof guardarFicha>[0];
const datosDe = (d: { data(): unknown }): Record<string, unknown> => d.data() as Record<string, unknown>;
const reloj = (c: Contexto): { ahora(): number } => ({ ahora: c.e.ahora });
const depsSitio = (c: Contexto): DepsSitio => ({ db: c.e.db, catalogo: c.e.catalogo, reloj: reloj(c) });
const ruta = (t: string, col: string, id?: string): string => `tenants/${t}/${col}${id === undefined ? '' : `/${id}`}`;

export const accionesConsola: TablaImplementaciones = {
  // ---- Productos (solo lectura) ---------------------------------------------------------------------------------
  catalogo: accion({
    esquema: VACIO,
    // Con un conteo abierto, sup/caj reciben `stockTotal` y `disponible` en null y la marca `existenciasOcultas`/`conteosAbiertos`.
    ejecutar: async (c) => ({ ...(await c.e.catalogo.listarProductosParaRol(c.tenantId, c.rol)) }),
  }),
  /**
   * Precio del día de cada mercado declarado por el comercio para los precios base dados (`precioUSD`, por clave de mercado
   * en minúsculas, en la moneda base del mercado), con el redondeo vigente del comercio. Una clave de un mercado no declarado se rechaza.
   */
  preciosDelDia: accion({
    esquema: objeto({
      precioUSD: z.record(z.string().regex(/^[a-z]{2}$/), z.number().nonnegative().max(9_999_999))
        .refine((r) => Object.keys(r).length <= MAX_MERCADOS, `Como máximo ${MAX_MERCADOS} mercados.`),
    }),
    ejecutar: async (c, d) => {
      const comercial = await c.e.comercialDelTenant(c.tenantId);
      const claves = new Set(comercial.mercados.map((m) => claveDePrecio(m.id)));
      if (Object.keys(d.precioUSD).some((k) => !claves.has(k))) throw new HttpsError('invalid-argument', 'Hay un precio de un mercado que el comercio no declara.');
      const cotizaciones: Record<string, CopiaCotizacion<string>> = {};
      for (const m of comercial.mercados) {
        if (m.tipoCambio == null) continue;
        try {
          cotizaciones[m.id] = await leerCotizacionDe(c.e.almacenCotizaciones, m.id, c.e.ahora(), { tenantId: c.tenantId, comercial });
        } catch (error) {
          if (!(error instanceof SinCotizacionUtilizable)) throw error;
        }
      }
      return preciosDelDiaDe(d.precioUSD, comercial, cotizaciones, await c.e.redondeoDelTenant(c.tenantId));
    },
  }),

  // ---- Fichas, secciones, carrusel y configuración del sitio -----------------------------------------------
  guardarFicha: accion({
    esquema: objeto({ productoId: ID_PRODUCTO, ficha: OBJETO }),
    ejecutar: async (c, d) => {
      await guardarFicha(depsSitio(c), { tenantId: c.tenantId, actor: c.actor, productoId: d.productoId, ficha: d.ficha });
      return { productoId: d.productoId };
    },
  }),
  leerFicha: accion({
    esquema: objeto({ productoId: ID_PRODUCTO }),
    ejecutar: async (c, d) => ({ ficha: (await c.e.firestore.doc(ruta(c.tenantId, 'fichasWeb', d.productoId)).get()).data() ?? null }),
  }),
  guardarSeccion: accion({
    esquema: objeto({ seccion: OBJETO }),
    ejecutar: async (c, d) => {
      await guardarSeccion(depsSitio(c), { tenantId: c.tenantId, actor: c.actor, seccion: d.seccion });
      return { ok: true };
    },
  }),
  eliminarSeccion: accion({
    esquema: objeto({ seccionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,29}$/) }),
    ejecutar: async (c, d) => {
      await eliminarSeccion(depsSitio(c), { tenantId: c.tenantId, actor: c.actor, seccionId: d.seccionId });
      return { ok: true };
    },
  }),
  ordenarSecciones: accion({
    esquema: objeto({ orden: z.array(z.string().max(30)).max(5) }),
    ejecutar: async (c, d) => {
      await ordenarSecciones(depsSitio(c), { tenantId: c.tenantId, actor: c.actor, orden: d.orden });
      return { ok: true };
    },
  }),
  guardarCarrusel: accion({
    esquema: objeto({ carrusel: OBJETO }),
    ejecutar: async (c, d) => {
      await guardarCarrusel(depsSitio(c), { tenantId: c.tenantId, actor: c.actor, carrusel: d.carrusel });
      return { ok: true };
    },
  }),
  guardarConfigSitio: accion({
    esquema: objeto({ config: OBJETO }),
    ejecutar: async (c, d) => {
      await guardarConfigSitio(depsSitio(c), { tenantId: c.tenantId, actor: c.actor, config: d.config });
      return { ok: true };
    },
  }),

  /** Lecturas del sitio (solo lectura; el navegador no las lee directo por la CSP del panel). */
  fichas: accion({
    esquema: VACIO,
    ejecutar: async (c) => ({
      fichas: (await c.e.firestore.collection(ruta(c.tenantId, 'fichasWeb')).limit(500).get()).docs.map((f) => ({ productoId: f.id, ficha: datosDe(f) })),
    }),
  }),
  /** Secciones en el orden del índice del sitio (las que no estén en el índice van al final). */
  secciones: accion({
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
    esquema: VACIO,
    ejecutar: async (c) => ({ carruseles: (await c.e.firestore.collection(ruta(c.tenantId, 'carruseles')).limit(50).get()).docs.map((x) => ({ plantilla: x.id, ...datosDe(x) })) }),
  }),
  /** Configuración del sitio, o `null` si aún no se guardó. */
  configSitio: accion({
    esquema: VACIO,
    ejecutar: async (c) => ({ config: (await c.e.firestore.doc(ruta(c.tenantId, 'sitio', 'config')).get()).data() ?? null }),
  }),

  /**
   * Datos generales del negocio que muestra el sitio (`sitio/negocio`): `{ negocio, version, enlacesPermitidos }` (negocio `null` y
   * versión 0 si aún no se guardaron). Supervisor y administrador.
   */
  leerNegocioSitio: accion({
    esquema: VACIO,
    ejecutar: (c) => leerNegocioSitio({ db: c.e.db }, c.tenantId, c.actor),
  }),
  /**
   * Guarda los datos del negocio (solo administrador). `versionEsperada` es la que leyó la pantalla (0 si no existía): con otra, `conflicto`.
   * Responde `{ version, afectados }`. La validación fina es la del servicio; aquí solo se acota la forma.
   */
  guardarNegocioSitio: accion({
    esquema: objeto({ negocio: OBJETO, versionEsperada: z.number().int().min(0).max(1_000_000_000) }),
    ejecutar: (c, d) => guardarNegocioSitio({ db: c.e.db, reloj: reloj(c) }, c.tenantId, c.actor, { negocio: d.negocio, versionEsperada: d.versionEsperada }),
  }),

  /** Logo subido como archivo: el vigente (ruta pública de sus versiones PNG y WebP) o `null`. */
  leerLogo: accion({
    esquema: VACIO,
    ejecutar: async (c) => ({ logo: await leerLogo(depsMedios(c), { tenantId: c.tenantId, actor: c.actor }) }),
  }),
  /** Quita el logo subido (solo `adm`); no toca ninguna URL de logo escrita a mano en otros módulos. */
  quitarLogo: accion({
    esquema: VACIO,
    ejecutar: (c) => quitarLogo(depsMedios(c), { tenantId: c.tenantId, actor: c.actor }),
  }),

  // ---- Publicación y tablero ------------------------------------------------------------------------------
  publicarSitio: accion({
    esquema: VACIO,
    ejecutar: (c) => publicarSitio({ db: c.e.db, catalogo: c.e.catalogo, reloj: reloj(c), disparador: c.e.disparadorSitio }, { tenantId: c.tenantId, actor: c.actor }),
  }),
  tablero: accion({
    esquema: VACIO,
    ejecutar: async (c) => obtenerTablero({ db: c.e.db, cotizaciones: c.e.almacenCotizaciones, comercial: await c.e.comercialDelTenant(c.tenantId), reloj: reloj(c) }, { tenantId: c.tenantId, actor: c.actor }),
  }),
  alertas: accion({
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
