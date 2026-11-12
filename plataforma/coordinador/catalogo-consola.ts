// `CatalogoPuerto` de la consola implementado con las funciones de Inventarios (dueño de productos y
// stock). Solo lectura: la consola no crea ni edita productos (el alta y la edición son de Inventarios).
import {
  esDisponible, leerDocumentoProducto, leerExistencias, leerProducto, rutaColeccionProductos, UBICACION_DISPONIBILIDAD, type ProductoLeido,
} from '@novutienda/inventarios';
import type { BaseDatosIdentidad } from '@novutienda/nucleo';
import type { CatalogoPuerto, Existencia, PrecioUSD, ProductoCatalogo } from '@novutienda/consola';
import type { LectorColecciones } from './colecciones.js';
import { centavosADolares } from './producto-inventarios.js';

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

    async leerProducto(tenantId, productoId) {
      return db.runTransaction(async (tx) => {
        const p = await leerProducto(tx, tenantId, productoId);
        return p === undefined ? undefined : aProductoConsola(p, enTienda(await leerExistencias(tx, tenantId, productoId)));
      });
    },

    async existenciasPorAlmacen(tenantId, productoId) {
      return db.runTransaction(async (tx): Promise<Existencia[]> => leerExistencias(tx, tenantId, productoId));
    },
  };
}
