// `CatalogoPuerto` de la consola implementado con las funciones de Inventarios (dueño de productos y
// stock). Solo lectura: la consola no crea ni edita productos (el alta y la edición son de Inventarios).
import {
  esDisponible, marcaOcultamiento, proyectarProducto, leerDocumentoProducto, leerExistencias, leerProducto, rutaColeccionProductos, UBICACION_DISPONIBILIDAD, type ProductoLeido,
} from '@novutienda/inventarios';
import type { BaseDatosIdentidad } from '@novutienda/nucleo';
import type { CatalogoPuerto, Existencia, ListadoCatalogoVisible, PrecioUSD, ProductoCatalogo, ProductoCatalogoVisible } from '@novutienda/consola';
import type { LectorColecciones } from './colecciones.js';
import { centavosADolares } from './producto-inventarios.js';
import { leerConteosAbiertos } from './stock-oculto.js';

export interface DepsCatalogoConsola {
  readonly db: BaseDatosIdentidad;
  readonly lector: LectorColecciones;
}

const aPrecioConsola = (c: ProductoLeido['precioCentavos']): PrecioUSD => ({ bo: centavosADolares(c.bo), ar: centavosADolares(c.ar) });

/** `cantidadTienda`: existencia en el almacén que decide la disponibilidad pública (regla única de Inventarios). */
function aProductoConsola(p: ProductoLeido, cantidadTienda: number): ProductoCatalogo {
  return {
    id: p.productoId,
    nombre: p.nombre,
    categoria: p.categoria ?? '',
    ...(p.marca !== undefined ? { marca: p.marca } : {}),
    ...(p.sku !== undefined ? { sku: p.sku } : {}),
    activo: p.activo,
    conSerie: p.conSerie,
    publicado: p.publicado,
    ...(p.garantiaMeses !== undefined ? { garantiaMeses: p.garantiaMeses } : {}),
    ...(p.minimo !== undefined ? { minimo: p.minimo } : {}),
    precioUSD: aPrecioConsola(p.precioCentavos),
    ...(p.stockTotal !== undefined ? { stockTotal: p.stockTotal } : {}),
    disponible: esDisponible({ activo: p.activo, ...(p.stockTotal !== undefined ? { stockTotal: p.stockTotal } : {}) }, cantidadTienda),
  };
}

const enTienda = (existencias: readonly { ubicacionId: string; cantidad: number }[]): number =>
  existencias.find((x) => x.ubicacionId === UBICACION_DISPONIBILIDAD)?.cantidad ?? 0;

export function crearCatalogoConsola(deps: DepsCatalogoConsola): CatalogoPuerto {
  const { db, lector } = deps;

  return {
    async listarProductos(tenantId) {
      const docs = await lector.listar(rutaColeccionProductos(tenantId));
      const productos = docs.map((d) => leerDocumentoProducto(d.id, d.datos));
      const tiendas = await db.runTransaction(async (tx) => {
        const salida = new Map<string, number>();
        for (const p of productos) salida.set(p.productoId, enTienda(await leerExistencias(tx, tenantId, p.productoId)));
        return salida;
      });
      return productos.map((p) => aProductoConsola(p, tiendas.get(p.productoId) ?? 0));
    },

    /** Misma regla que el callable `inventarios.listarProductos`: `adm` ve todo; `caj`/`sup` con un conteo abierto reciben `null` (no se omiten). */
    async listarProductosParaRol(tenantId, rol): Promise<ListadoCatalogoVisible> {
      const [docs, ubic] = await Promise.all([lector.listar(rutaColeccionProductos(tenantId)), lector.listar(`tenants/${tenantId}/ubicaciones`)]);
      const ubicaciones = ubic.map((u) => ({ id: u.id, data: u.datos }));
      return db.runTransaction(async (tx) => {
        const conteos = await leerConteosAbiertos(ubicaciones, async (id) => {
          const d = await tx.get(`tenants/${tenantId}/conteos/${id}`);
          return d.existe ? d.data() : undefined;
        });
        const productos: ProductoCatalogoVisible[] = [];
        for (const d of docs) {
          const p = leerDocumentoProducto(d.id, d.datos);
          const existencias: Record<string, number> = {};
          for (const x of await leerExistencias(tx, tenantId, p.productoId)) existencias[x.ubicacionId] = x.cantidad;
          const base = aProductoConsola(p, existencias[UBICACION_DISPONIBILIDAD] ?? 0);
          const visible = proyectarProducto(rol, conteos, {
            ...(p.stockTotal !== undefined ? { stockTotal: p.stockTotal } : {}), bajoMinimo: false, existencias, disponible: base.disponible,
          }, ubicaciones.map((u) => u.id));
          const { stockTotal: _s, disponible: _d, ...resto } = base;
          void _s; void _d;
          productos.push({ ...resto, ...(visible.stockTotal !== undefined ? { stockTotal: visible.stockTotal } : {}), disponible: visible.disponible });
        }
        return { productos, ...(marcaOcultamiento(rol, conteos) ?? {}) };
      });
    },

    async leerProducto(tenantId, productoId) {
      return db.runTransaction(async (tx) => {
        const p = await leerProducto(tx, tenantId, productoId);
        return p === undefined ? undefined : aProductoConsola(p, enTienda(await leerExistencias(tx, tenantId, productoId)));
      });
    },

    /** Lectura con la transacción del llamador (sin abrir otra): participa del control de conflictos de la escritura. */
    async existeProductoEnTransaccion(tx, tenantId, productoId) {
      return (await leerProducto(tx, tenantId, productoId)) !== undefined;
    },

    /** Datos mínimos del producto con la transacción del llamador; no lee existencias. `marca` solo si existe. */
    async leerProductoEnTransaccion(tx, tenantId, productoId) {
      const p = await leerProducto(tx, tenantId, productoId);
      if (p === undefined) return undefined;
      return {
        id: p.productoId, nombre: p.nombre, categoria: p.categoria ?? '',
        ...(p.marca !== undefined ? { marca: p.marca } : {}),
        activo: p.activo, precioUSD: aPrecioConsola(p.precioCentavos),
        ...(p.garantiaMeses !== undefined ? { garantiaMeses: p.garantiaMeses } : {}),
      };
    },

    async existenciasPorAlmacen(tenantId, productoId) {
      return db.runTransaction(async (tx): Promise<Existencia[]> => leerExistencias(tx, tenantId, productoId));
    },
  };
}
