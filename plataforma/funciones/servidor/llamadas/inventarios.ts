// Callable `inventarios`: todas las operaciones de Inventarios (ingreso, traspaso, ajuste, mermas, conteo
// ciego, costos, ubicaciones, importación CSV) y sus lecturas. Cada operación lleva un `operacionId` del
// cliente: repetirla no duplica nada (lo garantiza el módulo). Las lecturas no devuelven costos salvo a `adm`
// ni los teóricos de un conteo ciego a quien cuenta.
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  abrirConteo, actualizarProducto, ajustar, cerrarConteo, crearUbicacion, esDisponible, exportarProductosCsv, importarProductosCsv,
  ingresar, leerDocumentoProducto, registrarLineaConteo, resolverMerma, solicitarMerma, traspasar, UBICACION_DISPONIBILIDAD,
  type Autor, type LineaAjuste, type LineaIngreso, type LineaTraspaso, type ProductoExportable,
} from '@novutienda/inventarios';
import { accion, actorPos, type Contexto, type TablaAcciones } from './marco.js';
import { ID, ID_PRODUCTO, LIMITE, MS, TEXTO, UBICACION, VACIO, objeto, validarRango } from './comunes.js';

const TODOS = ['caj', 'sup', 'adm'] as const;
const SUPERVISION = ['sup', 'adm'] as const;

const autor = (c: Contexto): Autor => actorPos(c);

const ruta = (t: string, col: string, id?: string): string => `tenants/${t}/${col}${id === undefined ? '' : `/${id}`}`;
const datosDe = (d: { data(): unknown }): Record<string, unknown> => d.data() as Record<string, unknown>;
const SERIES = z.array(z.string().min(1).max(60)).min(1).max(500);
const LINEA_INGRESO = objeto({ productoId: ID_PRODUCTO, cantidad: z.number().int().positive().max(1_000_000), series: SERIES.optional() });

export const accionesInventarios: TablaAcciones = {
  // ---- Operaciones ------------------------------------------------------------------------------------------
  ingresar: accion({
    roles: SUPERVISION,
    maxCaracteres: 256_000,
    esquema: objeto({ operacionId: ID, ubicacionId: UBICACION, lineas: z.array(LINEA_INGRESO).min(1).max(50) }),
    ejecutar: (c, d) =>
      c.e.db.runTransaction((tx) =>
        ingresar(tx, { tenantId: c.tenantId, operacionId: d.operacionId, por: autor(c), ubicacionId: d.ubicacionId, lineas: d.lineas as unknown as LineaIngreso[] }),
      ),
  }),
  traspasar: accion({
    roles: SUPERVISION,
    maxCaracteres: 256_000,
    esquema: objeto({ operacionId: ID, origenId: UBICACION, destinoId: UBICACION, lineas: z.array(LINEA_INGRESO).min(1).max(50) }),
    ejecutar: (c, d) =>
      c.e.db.runTransaction((tx) =>
        traspasar(tx, { tenantId: c.tenantId, operacionId: d.operacionId, por: autor(c), origenId: d.origenId, destinoId: d.destinoId, lineas: d.lineas as unknown as LineaTraspaso[] }),
      ),
  }),
  ajustar: accion({
    roles: ['adm'],
    esquema: objeto({
      operacionId: ID, motivo: TEXTO(500),
      lineas: z.array(objeto({ productoId: ID_PRODUCTO, ubicacionId: UBICACION, delta: z.number().int().min(-1_000_000).max(1_000_000) })).min(1).max(50),
    }),
    ejecutar: (c, d) =>
      c.e.db.runTransaction((tx) => ajustar(tx, { tenantId: c.tenantId, operacionId: d.operacionId, por: autor(c), motivo: d.motivo, lineas: d.lineas as LineaAjuste[] })),
  }),
  solicitarMerma: accion({
    roles: TODOS,
    esquema: objeto({ operacionId: ID, productoId: ID_PRODUCTO, ubicacionId: UBICACION, cantidad: z.number().int().positive().max(1_000_000), series: SERIES.optional(), motivo: TEXTO(500) }),
    ejecutar: (c, d) =>
      c.e.db.runTransaction((tx) =>
        solicitarMerma(tx, {
          tenantId: c.tenantId, operacionId: d.operacionId, por: autor(c), productoId: d.productoId, ubicacionId: d.ubicacionId, cantidad: d.cantidad,
          ...(d.series !== undefined ? { series: d.series } : {}), motivo: d.motivo,
        }),
      ),
  }),
  resolverMerma: accion({
    roles: SUPERVISION,
    esquema: objeto({ operacionId: ID, mermaId: ID, decision: z.enum(['aprobada', 'rechazada']), motivo: TEXTO(500).optional() }),
    ejecutar: (c, d) =>
      c.e.db.runTransaction((tx) =>
        resolverMerma(tx, { tenantId: c.tenantId, operacionId: d.operacionId, por: autor(c), mermaId: d.mermaId, decision: d.decision, ...(d.motivo !== undefined ? { motivo: d.motivo } : {}) }),
      ),
  }),
  abrirConteo: accion({
    roles: SUPERVISION,
    esquema: objeto({ operacionId: ID, conteoId: ID, ubicacionId: UBICACION }),
    ejecutar: (c, d) =>
      c.e.db.runTransaction((tx) => abrirConteo(tx, { tenantId: c.tenantId, operacionId: d.operacionId, por: autor(c), conteoId: d.conteoId, ubicacionId: d.ubicacionId })),
  }),
  registrarLineaConteo: accion({
    roles: TODOS,
    esquema: objeto({ operacionId: ID, conteoId: ID, productoId: ID_PRODUCTO, contado: z.number().int().nonnegative().max(1_000_000).optional(), series: z.array(z.string().min(1).max(60)).max(500).optional() }),
    ejecutar: async (c, d) => {
      const r = await c.e.db.runTransaction((tx) =>
        registrarLineaConteo(tx, {
          tenantId: c.tenantId, operacionId: d.operacionId, por: autor(c), conteoId: d.conteoId, productoId: d.productoId,
          ...(d.contado !== undefined ? { contado: d.contado } : {}), ...(d.series !== undefined ? { series: d.series } : {}),
        }),
      );
      // Conteo ciego: quien cuenta no recibe el teórico, aunque el módulo lo devolviera.
      const { teorico: _t, esperado: _e, ...resultado } = r.resultado as Record<string, unknown>;
      void _t; void _e;
      return { resultado, repetida: r.repetida };
    },
  }),
  cerrarConteo: accion({
    roles: SUPERVISION,
    esquema: objeto({ operacionId: ID, conteoId: ID }),
    ejecutar: (c, d) => c.e.db.runTransaction((tx) => cerrarConteo(tx, { tenantId: c.tenantId, operacionId: d.operacionId, por: autor(c), conteoId: d.conteoId })),
  }),
  crearUbicacion: accion({
    roles: ['adm'],
    esquema: objeto({ operacionId: ID, ubicacionId: UBICACION, nombre: TEXTO(60) }),
    ejecutar: (c, d) =>
      c.e.db.runTransaction((tx) => crearUbicacion(tx, { tenantId: c.tenantId, operacionId: d.operacionId, por: autor(c), ubicacionId: d.ubicacionId, nombre: d.nombre })),
  }),
  /** Costo de un producto (solo `adm`): único camino para fijarlo; el alta y el precio van por `consola`. */
  fijarCosto: accion({
    roles: ['adm'],
    esquema: objeto({ operacionId: ID, productoId: ID_PRODUCTO, costoUSD: z.number().nonnegative().max(9_999_999) }),
    ejecutar: (c, d) =>
      c.e.db.runTransaction((tx) =>
        actualizarProducto(tx, { tenantId: c.tenantId, operacionId: d.operacionId, por: autor(c), productoId: d.productoId, cambios: { costoUSD: d.costoUSD } }),
      ),
  }),
  importarProductosCsv: accion({
    roles: ['adm'],
    maxCaracteres: 400_000,
    esquema: objeto({ operacionId: ID, csv: z.string().min(1).max(262_144), cargaInicial: z.boolean().optional() }),
    ejecutar: (c, d) =>
      c.e.db.runTransaction((tx) =>
        importarProductosCsv(tx, { tenantId: c.tenantId, operacionId: d.operacionId, por: autor(c), csv: d.csv, ...(d.cargaInicial !== undefined ? { cargaInicial: d.cargaInicial } : {}) }),
      ),
  }),

  // ---- Lecturas ---------------------------------------------------------------------------------------------
  /** Productos con existencias por almacén y disponibilidad (regla única de Inventarios). Sin costos. */
  listarProductos: accion({
    roles: TODOS,
    esquema: objeto({ soloBajoMinimo: z.boolean().optional() }),
    ejecutar: async (c, d) => {
      const [prods, exis] = await Promise.all([
        c.e.firestore.collection(ruta(c.tenantId, 'productos')).get(),
        c.e.firestore.collection(ruta(c.tenantId, 'existencias')).get(),
      ]);
      const porProducto = new Map<string, Record<string, number>>();
      for (const x of exis.docs) {
        const dd = x.data();
        if (typeof dd['productoId'] === 'string' && typeof dd['ubicacionId'] === 'string' && typeof dd['cantidad'] === 'number') {
          porProducto.set(dd['productoId'], { ...(porProducto.get(dd['productoId']) ?? {}), [dd['ubicacionId']]: dd['cantidad'] });
        }
      }
      const productos = prods.docs
        .map((p) => ({ leido: leerDocumentoProducto(p.id, p.data()), bajoMinimo: p.data()['bajoMinimo'] === true }))
        .filter((p) => d.soloBajoMinimo !== true || p.bajoMinimo)
        .map(({ leido: p, bajoMinimo }) => {
          const existencias = porProducto.get(p.productoId) ?? {};
          return {
            id: p.productoId, nombre: p.nombre, categoria: p.categoria ?? '', marca: p.marca, sku: p.sku, activo: p.activo, publicado: p.publicado, conSerie: p.conSerie,
            garantiaMeses: p.garantiaMeses, minimo: p.minimo, precioCentavosUSD: p.precioCentavos, stockTotal: p.stockTotal, bajoMinimo, existencias,
            disponible: esDisponible({ activo: p.activo, ...(p.stockTotal !== undefined ? { stockTotal: p.stockTotal } : {}) }, existencias[UBICACION_DISPONIBILIDAD] ?? 0),
          };
        });
      return { productos };
    },
  }),
  ubicaciones: accion({
    roles: TODOS,
    esquema: VACIO,
    ejecutar: async (c) => ({ ubicaciones: (await c.e.firestore.collection(ruta(c.tenantId, 'ubicaciones')).get()).docs.map((u) => ({ id: u.id, ...u.data() })) }),
  }),
  costos: accion({
    roles: ['adm'],
    esquema: VACIO,
    ejecutar: async (c) => ({ costos: (await c.e.firestore.collection(ruta(c.tenantId, 'costos')).get()).docs.map((x) => ({ productoId: x.id, costoUSD: x.data()['costoUSD'] })) }),
  }),
  /** Búsqueda por serie: estado, almacén, venta y vencimiento de garantía. */
  buscarSerie: accion({
    roles: TODOS,
    esquema: objeto({ serie: TEXTO(60), productoId: ID_PRODUCTO.optional() }),
    ejecutar: async (c, d) => {
      let q = c.e.firestore.collection(ruta(c.tenantId, 'unidades')).where('serie', '==', d.serie);
      if (d.productoId !== undefined) q = q.where('productoId', '==', d.productoId);
      return { unidades: (await q.limit(20).get()).docs.map(datosDe) };
    },
  }),
  movimientos: accion({
    roles: SUPERVISION,
    esquema: objeto({ productoId: ID_PRODUCTO.optional(), desde: MS.optional(), hasta: MS.optional(), limite: LIMITE.optional() }),
    ejecutar: async (c, d) => {
      validarRango(d.desde, d.hasta);
      let q = c.e.firestore.collection(ruta(c.tenantId, 'movimientos')).orderBy('fecha', 'desc');
      if (d.productoId !== undefined) q = q.where('productoId', '==', d.productoId);
      if (d.desde !== undefined) q = q.where('fecha', '>=', new Date(d.desde));
      if (d.hasta !== undefined) q = q.where('fecha', '<=', new Date(d.hasta));
      return { movimientos: (await q.limit(d.limite ?? 100).get()).docs.map(datosDe) };
    },
  }),
  mermas: accion({
    roles: SUPERVISION,
    esquema: objeto({ estado: z.enum(['solicitada', 'aprobada', 'rechazada']).optional(), limite: LIMITE.optional() }),
    ejecutar: async (c, d) => {
      let q = c.e.firestore.collection(ruta(c.tenantId, 'mermas')).limit(d.limite ?? 100);
      if (d.estado !== undefined) q = q.where('estado', '==', d.estado);
      return { mermas: (await q.get()).docs.map((m) => ({ id: m.id, ...m.data() })) };
    },
  }),
  /** Conteo ciego: quien cuenta ve sus líneas, nunca los teóricos (`conteoTeoricos` no se lee aquí). */
  conteo: accion({
    roles: TODOS,
    esquema: objeto({ conteoId: ID }),
    ejecutar: async (c, d) => {
      const conteo = (await c.e.firestore.doc(ruta(c.tenantId, 'conteos', d.conteoId)).get()).data();
      if (conteo === undefined) throw new HttpsError('not-found', 'El conteo no existe.');
      const lineas = await c.e.firestore.collection(ruta(c.tenantId, 'conteoLineas')).where('conteoId', '==', d.conteoId).limit(500).get();
      return { conteo, lineas: lineas.docs.map(datosDe) };
    },
  }),
  conteos: accion({
    roles: TODOS,
    esquema: objeto({ estado: z.enum(['abierto', 'cerrado']).optional(), limite: LIMITE.optional() }),
    ejecutar: async (c, d) => {
      let q = c.e.firestore.collection(ruta(c.tenantId, 'conteos')).limit(d.limite ?? 50);
      if (d.estado !== undefined) q = q.where('estado', '==', d.estado);
      return { conteos: (await q.get()).docs.map((x) => ({ id: x.id, ...x.data() })) };
    },
  }),
  exportarCsv: accion({
    roles: SUPERVISION,
    esquema: objeto({ conCostos: z.boolean().optional() }),
    ejecutar: async (c, d) => {
      const conCostos = d.conCostos === true;
      if (conCostos && c.rol !== 'adm') throw new HttpsError('permission-denied', 'Solo el administrador exporta costos.');
      const [prods, costos] = await Promise.all([
        c.e.firestore.collection(ruta(c.tenantId, 'productos')).get(),
        conCostos ? c.e.firestore.collection(ruta(c.tenantId, 'costos')).get() : Promise.resolve(undefined),
      ]);
      const costo = new Map(costos?.docs.map((x) => [x.id, x.data()['costoUSD']]) ?? []);
      const filas: ProductoExportable[] = prods.docs.map((x) => {
        const p = leerDocumentoProducto(x.id, x.data());
        const cu = costo.get(x.id);
        return {
          id: p.productoId, nombre: p.nombre, categoria: p.categoria ?? '', ...(p.marca !== undefined ? { marca: p.marca } : {}), sku: p.sku ?? p.productoId,
          conSerie: p.conSerie, ...(p.garantiaMeses !== undefined ? { garantiaMeses: p.garantiaMeses } : {}), ...(p.minimo !== undefined ? { minimo: p.minimo } : {}),
          precioUSD: { bo: p.precioCentavos.bo / 100, ar: p.precioCentavos.ar / 100 }, ...(typeof cu === 'number' ? { costoUSD: cu } : {}), activo: p.activo, publicado: p.publicado,
        };
      });
      return { csv: exportarProductosCsv(filas) };
    },
  }),
};

