// Callable `consola`: catálogo web (productos, precios, fichas), secciones, carrusel, configuración del sitio,
// importación, publicación, tablero y usuarios (`asignarRol`/`quitarRol`). La consola nunca escribe productos
// ni stock por su cuenta: crea y edita por Inventarios (puerto del catálogo) dentro de su propia transacción.
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  cambiarPrecioUSD, crearProductoConsola, editarProductoConsola, eliminarSeccion, exportarProductosCsv, guardarCarrusel,
  guardarConfigSitio, guardarFicha, guardarSeccion, importarProductos, obtenerTablero, ordenarSecciones, preciosDelDia, publicarSitio,
  simularImportacion, type DepsImportacion,
} from '@plataforma/consola';
import { asignarRol, leerCotizacion, quitarRol, SinCotizacionUtilizable, type CopiaCotizacion, type Mercado, type Rol } from '@plataforma/nucleo';
import { accion, type Contexto, type TablaAcciones } from './marco.js';
import { ID_PRODUCTO, LIMITE, OBJETO, VACIO, objeto } from './comunes.js';

const ADM = ['adm'] as const;
const SUPERVISION = ['sup', 'adm'] as const;

type DepsSitio = Parameters<typeof guardarFicha>[0];
const reloj = (c: Contexto): { ahora(): number } => ({ ahora: c.e.ahora });
const depsSitio = (c: Contexto): DepsSitio => ({ db: c.e.db, catalogo: c.e.catalogo, reloj: reloj(c) });
const depsImportacion = (c: Contexto): DepsImportacion => ({ db: c.e.db, catalogo: c.e.catalogo, reloj: reloj(c) });
const ruta = (t: string, col: string, id?: string): string => `tenants/${t}/${col}${id === undefined ? '' : `/${id}`}`;

const ROL = z.enum(['caj', 'sup', 'adm']);
const UID = z.string().min(1).max(128).regex(/^[^/\s]+$/, 'uid inválido');
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

  // ---- Usuarios (3 como máximo) ---------------------------------------------------------------------------
  /** Miembros del tenant con su correo (`sup`/`adm`). */
  listarUsuarios: accion({
    roles: SUPERVISION,
    esquema: VACIO,
    ejecutar: async (c) => {
      const miembros = (await c.e.firestore.collection(ruta(c.tenantId, 'miembros')).get()).docs;
      if (miembros.length === 0) return { usuarios: [] };
      const { users } = await c.e.auth.getUsers(miembros.slice(0, 100).map((m) => ({ uid: m.id })));
      const porUid = new Map(users.map((u) => [u.uid, u]));
      return {
        usuarios: miembros.map((m) => {
          const u = porUid.get(m.id);
          return { uid: m.id, rol: m.data()['rol'], correo: u?.email ?? null, correoVerificado: u?.emailVerified ?? false, deshabilitado: u?.disabled ?? false };
        }),
      };
    },
  }),
  /** Busca un usuario existente por correo para poder asignarle rol (solo `adm`). La cuenta debe existir y estar verificada. */
  buscarUsuarioPorCorreo: accion({
    roles: ADM,
    propietario: true,
    esquema: objeto({ correo: z.string().email().max(120) }),
    ejecutar: async (c, d) => {
      try {
        const u = await c.e.auth.getUserByEmail(d.correo);
        return { uid: u.uid, correoVerificado: u.emailVerified, conContrasena: u.providerData.some((p) => p.providerId === 'password') };
      } catch (error) {
        if ((error as { code?: unknown }).code === 'auth/user-not-found') throw new HttpsError('not-found', 'No existe una cuenta con ese correo.');
        throw error;
      }
    },
  }),
  asignarRol: accion({
    roles: ADM,
    propietario: true,
    esquema: objeto({ uid: UID, rol: ROL }),
    ejecutar: async (c, d) => ({ claim: await asignarRol({ auth: c.e.authMin, db: c.e.db, ahora: c.e.ahora }, c.actor, c.tenantId, d.uid, d.rol as Rol) }),
  }),
  quitarRol: accion({
    roles: ADM,
    propietario: true,
    esquema: objeto({ uid: UID }),
    ejecutar: async (c, d) => ({ claim: await quitarRol({ auth: c.e.authMin, db: c.e.db, ahora: c.e.ahora }, c.actor, c.tenantId, d.uid) }),
  }),
};

