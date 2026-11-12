// Callable `inventarios`: todas las operaciones de Inventarios (ingreso, traspaso, ajuste, mermas, conteo
// ciego, costos, ubicaciones, importación CSV) y sus lecturas. Cada operación lleva un `operacionId` del
// cliente: repetirla no duplica nada (lo garantiza el módulo). Las lecturas no devuelven costos salvo a `adm`
// ni los teóricos de un conteo ciego a quien cuenta.
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  abrirConteo, actualizarProducto, ajustar, cerrarConteo, crearProducto, crearUbicacion, esDisponible, exportarProductosCsv, importarCsvPorLotes,
  ingresar, leerDocumentoProducto, registrarLineaConteo, resolverMerma, simularImportacionCsv, solicitarMerma, traspasar, UBICACION_DISPONIBILIDAD,
  type Autor, type CambiosProducto, type EntradaProducto, type LineaAjuste, type PrecioUSD, type LineaIngreso, type LineaTraspaso, type ProductoExportable,
} from '@novutienda/inventarios';
import { MERCADOS } from '@novutienda/nucleo';
import { accion, actorPos, type Contexto, type TablaImplementaciones } from './marco.js';
import { ID, ID_PRODUCTO, LIMITE, MS, TEXTO, UBICACION, VACIO, objeto, validarRango } from './comunes.js';


const autor = (c: Contexto): Autor => actorPos(c);

const ruta = (t: string, col: string, id?: string): string => `tenants/${t}/${col}${id === undefined ? '' : `/${id}`}`;
const datosDe = (d: { data(): unknown }): Record<string, unknown> => d.data() as Record<string, unknown>;
/** Tiempo que la importación se da antes de detenerse limpiamente (el callable vive 60 s); se retoma con el mismo `operacionId`. */
const PRESUPUESTO_IMPORTACION_MS = 40_000;
const SERIES = z.array(z.string().min(1).max(60)).min(1).max(500);
const LINEA_INGRESO = objeto({ productoId: ID_PRODUCTO, cantidad: z.number().int().positive().max(1_000_000), series: SERIES.optional() });

const centavos = z.number().int().nonnegative().max(100_000_000_00);
/** Un precio por cada mercado del núcleo (centavos de USD); no se escribe `bo`/`ar` a mano. */
const PRECIO = objeto(Object.fromEntries(MERCADOS.map((m) => [m.toLowerCase(), centavos])) as Record<string, typeof centavos>);
const SKU = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/, 'sku inválido');
const GARANTIA = z.number().int().min(1).max(120);
const MINIMO = z.number().int().nonnegative().max(1_000_000_000);

/** Ids de productos con existencia en la ubicación de un conteo (solo uso interno del servidor: nunca se devuelven a quien cuenta). */
async function productosConExistenciaEn(c: Contexto, conteo: Record<string, unknown>): Promise<string[]> {
  if (typeof conteo['ubicacionId'] !== 'string') return [];
  const ex = await c.e.firestore.collection(ruta(c.tenantId, 'existencias')).where('ubicacionId', '==', conteo['ubicacionId']).limit(1000).get();
  return ex.docs.map(datosDe).filter((x) => Number(x['cantidad']) > 0 && typeof x['productoId'] === 'string').map((x) => String(x['productoId']));
}

export const accionesInventarios: TablaImplementaciones = {
  // ---- Operaciones ------------------------------------------------------------------------------------------
  ingresar: accion({
    maxCaracteres: 256_000,
    esquema: objeto({ operacionId: ID, ubicacionId: UBICACION, lineas: z.array(LINEA_INGRESO).min(1).max(50) }),
    ejecutar: (c, d) =>
      c.e.db.runTransaction((tx) =>
        ingresar(tx, { tenantId: c.tenantId, operacionId: d.operacionId, por: autor(c), ubicacionId: d.ubicacionId, lineas: d.lineas as unknown as LineaIngreso[] }),
      ),
  }),
  traspasar: accion({
    maxCaracteres: 256_000,
    esquema: objeto({ operacionId: ID, origenId: UBICACION, destinoId: UBICACION, lineas: z.array(LINEA_INGRESO).min(1).max(50) }),
    ejecutar: (c, d) =>
      c.e.db.runTransaction((tx) =>
        traspasar(tx, { tenantId: c.tenantId, operacionId: d.operacionId, por: autor(c), origenId: d.origenId, destinoId: d.destinoId, lineas: d.lineas as unknown as LineaTraspaso[] }),
      ),
  }),
  ajustar: accion({
    esquema: objeto({
      operacionId: ID, motivo: TEXTO(500),
      lineas: z.array(objeto({ productoId: ID_PRODUCTO, ubicacionId: UBICACION, delta: z.number().int().min(-1_000_000).max(1_000_000) })).min(1).max(50),
    }),
    ejecutar: (c, d) =>
      c.e.db.runTransaction((tx) => ajustar(tx, { tenantId: c.tenantId, operacionId: d.operacionId, por: autor(c), motivo: d.motivo, lineas: d.lineas as LineaAjuste[] })),
  }),
  solicitarMerma: accion({
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
    esquema: objeto({ operacionId: ID, mermaId: ID, decision: z.enum(['aprobada', 'rechazada']), motivo: TEXTO(500).optional() }),
    ejecutar: (c, d) =>
      c.e.db.runTransaction((tx) =>
        resolverMerma(tx, { tenantId: c.tenantId, operacionId: d.operacionId, por: autor(c), mermaId: d.mermaId, decision: d.decision, ...(d.motivo !== undefined ? { motivo: d.motivo } : {}) }),
      ),
  }),
  abrirConteo: accion({
    esquema: objeto({ operacionId: ID, conteoId: ID, ubicacionId: UBICACION }),
    ejecutar: (c, d) =>
      c.e.db.runTransaction((tx) => abrirConteo(tx, { tenantId: c.tenantId, operacionId: d.operacionId, por: autor(c), conteoId: d.conteoId, ubicacionId: d.ubicacionId })),
  }),
  registrarLineaConteo: accion({
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
    esquema: objeto({ operacionId: ID, conteoId: ID }),
    ejecutar: async (c, d) => {
      // Productos con existencia en la ubicación del conteo: los que nadie contó se tratan como contados en 0.
      const conteo = (await c.e.firestore.doc(ruta(c.tenantId, 'conteos', d.conteoId)).get()).data();
      const productosConExistencia = conteo === undefined ? [] : await productosConExistenciaEn(c, conteo);
      return c.e.db.runTransaction((tx) => cerrarConteo(tx, { tenantId: c.tenantId, operacionId: d.operacionId, por: autor(c), conteoId: d.conteoId, productosConExistencia }));
    },
  }),
  crearUbicacion: accion({
    esquema: objeto({ operacionId: ID, ubicacionId: UBICACION, nombre: TEXTO(60) }),
    ejecutar: (c, d) =>
      c.e.db.runTransaction((tx) => crearUbicacion(tx, { tenantId: c.tenantId, operacionId: d.operacionId, por: autor(c), ubicacionId: d.ubicacionId, nombre: d.nombre })),
  }),
  /** Alta de un producto (solo `adm`); respeta el tope de productos del plan. Precios y costo en centavos de USD. */
  crearProducto: accion({
    esquema: objeto({
      operacionId: ID,
      producto: objeto({
        id: ID_PRODUCTO, nombre: TEXTO(120), categoria: TEXTO(60), marca: TEXTO(60).optional(), sku: SKU, activo: z.boolean().optional(),
        publicado: z.boolean().optional(), conSerie: z.boolean().optional(), garantiaMeses: GARANTIA.optional(), minimo: MINIMO.optional(),
        precioUSD: PRECIO, costoUSD: centavos.optional(), controlaStock: z.boolean().optional(),
      }),
    }),
    ejecutar: (c, d) =>
      c.e.db.runTransaction((tx) =>
        crearProducto(tx, { tenantId: c.tenantId, operacionId: d.operacionId, por: autor(c), producto: d.producto as unknown as EntradaProducto }),
      ),
  }),
  /**
   * Edición de la ficha de inventario (solo `adm`). Campo ausente = sin cambio; `null` vacía marca, garantía, mínimo o costo.
   * Nombre, categoría y precios no se vacían. `conSerie` no cambia tras el primer movimiento.
   */
  editarProducto: accion({
    esquema: objeto({
      operacionId: ID, productoId: ID_PRODUCTO,
      cambios: objeto({
        nombre: TEXTO(120).optional(), categoria: TEXTO(60).optional(), marca: TEXTO(60).nullable().optional(), activo: z.boolean().optional(),
        publicado: z.boolean().optional(), conSerie: z.boolean().optional(), garantiaMeses: GARANTIA.nullable().optional(),
        minimo: MINIMO.nullable().optional(), precioUSD: PRECIO.optional(), costoUSD: centavos.nullable().optional(),
      }),
    }),
    ejecutar: (c, d) =>
      c.e.db.runTransaction((tx) =>
        actualizarProducto(tx, { tenantId: c.tenantId, operacionId: d.operacionId, por: autor(c), productoId: d.productoId, cambios: d.cambios as unknown as CambiosProducto }),
      ),
  }),
  /** Cambia el precio base por mercado (solo `adm`): centavos de USD. La auditoría guarda el precio anterior y el nuevo. */
  cambiarPrecioUSD: accion({
    esquema: objeto({ operacionId: ID, productoId: ID_PRODUCTO, precioUSD: PRECIO }),
    ejecutar: (c, d) =>
      c.e.db.runTransaction((tx) =>
        actualizarProducto(tx, { tenantId: c.tenantId, operacionId: d.operacionId, por: autor(c), productoId: d.productoId, cambios: { precioUSD: d.precioUSD as unknown as PrecioUSD } }),
      ),
  }),
  /**
   * Importación de productos desde CSV (solo `adm`): CREA los nuevos y ACTUALIZA los existentes (se identifican por `id`;
   * celda vacía = sin cambio). Hasta 1000 filas. Con `simular: true` no escribe nada ni usa `operacionId`: devuelve
   * `{ simular: true, simulacion }` con el plan fila por fila. Sin `simular` exige `operacionId` y aplica por tandas
   * (una transacción por tanda, no «todo o nada» entre tandas); ver `importarCsvPorLotes`. El stock solo entra con
   * `cargaInicial` y solo en productos nuevos sin serie.
   */
  importarProductosCsv: accion({
    maxCaracteres: 400_000,
    esquema: objeto({
      operacionId: ID.optional(), csv: z.string().min(1).max(262_144), cargaInicial: z.boolean().optional(),
      simular: z.boolean().optional(), omitirErrores: z.boolean().optional(),
    }),
    ejecutar: async (c, d) => {
      if (d.simular === true) {
        const simulacion = await c.e.db.runTransaction((tx) =>
          simularImportacionCsv(tx, { tenantId: c.tenantId, por: autor(c), csv: d.csv, ...(d.cargaInicial !== undefined ? { cargaInicial: d.cargaInicial } : {}) }),
        );
        return { simular: true, simulacion };
      }
      if (d.operacionId === undefined) throw new HttpsError('invalid-argument', 'Falta operacionId: solo la simulación puede omitirlo.');
      const r = await importarCsvPorLotes(c.e.db, {
        tenantId: c.tenantId, operacionId: d.operacionId, por: autor(c), csv: d.csv, presupuestoMs: PRESUPUESTO_IMPORTACION_MS,
        ...(d.cargaInicial !== undefined ? { cargaInicial: d.cargaInicial } : {}), ...(d.omitirErrores !== undefined ? { omitirErrores: d.omitirErrores } : {}),
      });
      return { simular: false, ...r };
    },
  }),

  // ---- Lecturas ---------------------------------------------------------------------------------------------
  /** Productos con existencias por almacén y disponibilidad (regla única de Inventarios). Sin costos. */
  listarProductos: accion({
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
    esquema: VACIO,
    ejecutar: async (c) => ({ ubicaciones: (await c.e.firestore.collection(ruta(c.tenantId, 'ubicaciones')).get()).docs.map((u) => ({ id: u.id, ...u.data() })) }),
  }),
  costos: accion({
    esquema: VACIO,
    ejecutar: async (c) => ({ costos: (await c.e.firestore.collection(ruta(c.tenantId, 'costos')).get()).docs.filter((x) => typeof x.data()['costoUSD'] === 'number').map((x) => ({ productoId: x.id, costoUSD: x.data()['costoUSD'] })) }),
  }),
  /** Búsqueda por serie: estado, almacén, venta y vencimiento de garantía. */
  buscarSerie: accion({
    esquema: objeto({ serie: TEXTO(60), productoId: ID_PRODUCTO.optional() }),
    ejecutar: async (c, d) => {
      let q = c.e.firestore.collection(ruta(c.tenantId, 'unidades')).where('serie', '==', d.serie);
      if (d.productoId !== undefined) q = q.where('productoId', '==', d.productoId);
      return { unidades: (await q.limit(20).get()).docs.map(datosDe) };
    },
  }),
  /**
   * Unidades con serie de un producto (sin costos: la unidad no guarda costo). Filtros de igualdad, que no piden índice
   * compuesto. Devuelve solo los campos de la vista (la referencia de venta como id de venta).
   */
  series: accion({
    esquema: objeto({ productoId: ID_PRODUCTO, ubicacionId: UBICACION.optional(), soloDisponibles: z.boolean().optional(), limite: LIMITE.optional() }),
    ejecutar: async (c, d) => {
      let q = c.e.firestore.collection(ruta(c.tenantId, 'unidades')).where('productoId', '==', d.productoId);
      if (d.ubicacionId !== undefined) q = q.where('ubicacionId', '==', d.ubicacionId);
      if (d.soloDisponibles === true) q = q.where('estado', '==', 'disponible');
      const snap = await q.limit(d.limite ?? 200).get();
      const unidades = snap.docs.map((u) => {
        const x = datosDe(u);
        const ref = x['ventaRef'] as { id?: unknown } | undefined;
        return {
          productoId: x['productoId'], serie: x['serie'], estado: x['estado'], ubicacionId: x['ubicacionId'],
          ...(typeof ref?.id === 'string' ? { ventaRef: ref.id } : {}),
          ...(typeof x['garantiaHasta'] === 'string' ? { garantiaHasta: x['garantiaHasta'] } : {}),
        };
      });
      unidades.sort((a, b) => String(a.serie).localeCompare(String(b.serie)));
      return { unidades };
    },
  }),
  /**
   * Movimientos. El costo unitario (`costoUSDUnit`) es solo del administrador. Los filtros `tipo` y `uid` (autor) se
   * aplican sobre una ventana de los últimos 1000 movimientos del resto de los filtros, para no exigir índices
   * compuestos nuevos.
   */
  movimientos: accion({
    esquema: objeto({
      productoId: ID_PRODUCTO.optional(), desde: MS.optional(), hasta: MS.optional(), limite: LIMITE.optional(),
      tipo: z.string().regex(/^[a-z][a-z-]{0,29}$/).optional(), uid: z.string().min(1).max(128).optional(),
    }),
    ejecutar: async (c, d) => {
      validarRango(d.desde, d.hasta);
      const limite = d.limite ?? 100;
      const filtraEnMemoria = d.tipo !== undefined || d.uid !== undefined;
      let q = c.e.firestore.collection(ruta(c.tenantId, 'movimientos')).orderBy('fecha', 'desc');
      if (d.productoId !== undefined) q = q.where('productoId', '==', d.productoId);
      if (d.desde !== undefined) q = q.where('fecha', '>=', new Date(d.desde));
      if (d.hasta !== undefined) q = q.where('fecha', '<=', new Date(d.hasta));
      // Se pide uno más que el límite para saber si la lista vino cortada; con filtros en memoria la ventana es de 1000.
      const ventana = filtraEnMemoria ? 1000 : limite + 1;
      const docs = (await q.limit(ventana).get()).docs;
      const coinciden = docs
        .map(datosDe)
        .filter((m) => (d.tipo === undefined || m['tipo'] === d.tipo) && (d.uid === undefined || m['por'] === d.uid));
      const cortada = coinciden.length > limite || (filtraEnMemoria && docs.length === ventana);
      const filas = coinciden.slice(0, limite);
      const movimientos = c.rol === 'adm' ? filas : filas.map(({ costoUSDUnit: _costo, ...resto }) => { void _costo; return resto; });
      return { movimientos, cortada };
    },
  }),
  mermas: accion({
    esquema: objeto({ estado: z.enum(['solicitada', 'aprobada', 'rechazada']).optional(), limite: LIMITE.optional() }),
    ejecutar: async (c, d) => {
      const limite = d.limite ?? 100;
      let q = c.e.firestore.collection(ruta(c.tenantId, 'mermas')).limit(limite + 1);
      if (d.estado !== undefined) q = q.where('estado', '==', d.estado);
      const docs = (await q.get()).docs;
      return { mermas: docs.slice(0, limite).map((m) => ({ id: m.id, ...m.data() })), cortada: docs.length > limite };
    },
  }),
  /**
   * Conteo ciego: quien cuenta ve sus líneas, nunca los teóricos. `resultado` (teórico, contado, diferencia por
   * producto) lo reciben `sup`/`adm` SOLO con el conteo cerrado; con el conteo abierto no se lee `conteoTeoricos`.
   */
  conteo: accion({
    esquema: objeto({ conteoId: ID }),
    ejecutar: async (c, d) => {
      const conteo = (await c.e.firestore.doc(ruta(c.tenantId, 'conteos', d.conteoId)).get()).data();
      if (conteo === undefined) throw new HttpsError('not-found', 'El conteo no existe.');
      const lineas = await c.e.firestore.collection(ruta(c.tenantId, 'conteoLineas')).where('conteoId', '==', d.conteoId).limit(500).get();
      const filas = lineas.docs.map(datosDe);
      if (c.rol === 'caj') return { conteo, lineas: filas };
      if (conteo['estado'] !== 'cerrado') {
        // Para avisar antes de cerrar: cuántos productos con existencia aún no se contaron. Solo el número (sup/adm), sin ids
        // ni cantidades; el cierre los cuenta en 0 y abre una merma por cada uno.
        const contados = new Set(Array.isArray(conteo['productos']) ? (conteo['productos'] as unknown[]).map(String) : []);
        const faltan = (await productosConExistenciaEn(c, conteo)).filter((p) => !contados.has(p)).length;
        return { conteo, lineas: filas, faltan };
      }
      const teoricos = await c.e.firestore.collection(ruta(c.tenantId, 'conteoTeoricos')).where('conteoId', '==', d.conteoId).limit(500).get();
      const porProducto = new Map(teoricos.docs.map((t) => [String(t.data()['productoId']), Number(t.data()['cantidad'])]));
      const resultado = filas.map((l) => {
        const teorico = porProducto.get(String(l['productoId'])) ?? 0;
        const contado = Number(l['contado']);
        return { productoId: l['productoId'], teorico, contado, diferencia: contado - teorico };
      });
      return { conteo, lineas: filas, resultado };
    },
  }),
  conteos: accion({
    esquema: objeto({ estado: z.enum(['abierto', 'cerrado']).optional(), limite: LIMITE.optional() }),
    ejecutar: async (c, d) => {
      let q = c.e.firestore.collection(ruta(c.tenantId, 'conteos')).limit(d.limite ?? 50);
      if (d.estado !== undefined) q = q.where('estado', '==', d.estado);
      return { conteos: (await q.get()).docs.map((x) => ({ id: x.id, ...x.data() })) };
    },
  }),
  exportarCsv: accion({
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
          precioUSD: { bo: p.precioCentavos.bo, ar: p.precioCentavos.ar }, ...(typeof cu === 'number' ? { costoUSD: cu } : {}), activo: p.activo, publicado: p.publicado,
        };
      });
      return { csv: exportarProductosCsv(filas) };
    },
  }),
};
