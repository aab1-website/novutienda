// `CatalogoPuerto` de la consola implementado con las funciones de Inventarios (dueño de productos y
// stock). La consola nunca escribe esas colecciones; todo pasa por `crearProducto` y `actualizarProducto`,
// dentro de la transacción que abre la consola (la misma que anota el cambio y la auditoría).
import {
  EntradaInvalida, actualizarProducto, crearProducto, esDisponible, leerDocumentoProducto, leerExistencias, leerProducto,
  rutaColeccionProductos, skuDesdeId, UBICACION_DISPONIBILIDAD, type Autor, type CambiosProducto, type ProductoLeido,
} from '@novutienda/inventarios';
import type { BaseDatosIdentidad, TransaccionIdentidad } from '@novutienda/nucleo';
import type { CatalogoPuerto, Existencia, PrecioUSD, ProductoCatalogo } from '@novutienda/consola';
import type { LectorColecciones } from './colecciones.js';
import { centavosADolares, dolaresACentavos } from './producto-inventarios.js';

export interface DepsCatalogoConsola {
  readonly db: BaseDatosIdentidad;
  readonly lector: LectorColecciones;
}

/** El puerto de la consola solo trae el uid de quien opera; la consola ya exigió rol `adm`. */
const autorAdm = (uid: string): Autor => ({ uid, rol: 'adm' });

const aPrecioConsola = (c: ProductoLeido['precioCentavos']): PrecioUSD => ({ bo: centavosADolares(c.bo), ar: centavosADolares(c.ar) });
const aPrecioInventarios = (p: PrecioUSD): { bo: number; ar: number } => ({ bo: dolaresACentavos(p.bo), ar: dolaresACentavos(p.ar) });

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

    /**
     * Alta con el tope de 200 productos: `crearProducto` de Inventarios reserva el cupo del contador
     * `contadores/uso` (el mismo que `verificarYReservar` del núcleo) en la transacción de la consola. Id de
     * operación determinista: reintentar el alta con el mismo contenido no duplica ni gasta otro cupo.
     * Sin SKU, el SKU se deriva del id del producto (`skuDesdeId`): Inventarios exige uno único.
     */
    async crearProducto(tx, tenantId, productoId, datos, precioUSD, por) {
      await crearProducto(tx, {
        tenantId,
        operacionId: `consola-crear-${productoId}`,
        por: autorAdm(por),
        producto: {
          id: productoId,
          nombre: datos.nombre,
          categoria: datos.categoria,
          ...(datos.marca !== undefined ? { marca: datos.marca } : {}),
          sku: datos.sku ?? skuDesdeId(productoId),
          activo: datos.activo,
          ...(datos.conSerie !== undefined ? { conSerie: datos.conSerie } : {}),
          ...(datos.publicado !== undefined ? { publicado: datos.publicado } : {}),
          ...(datos.garantiaMeses !== undefined ? { garantiaMeses: datos.garantiaMeses } : {}),
          ...(datos.minimo !== undefined ? { minimo: datos.minimo } : {}),
          precioUSD: aPrecioInventarios(precioUSD),
        },
      });
    },

    /** La operación lleva la versión leída: repetir la misma edición es idempotente; otra edición sobre la misma versión es conflicto. */
    async actualizarDatosProducto(tx, tenantId, productoId, cambios, por) {
      if (cambios.sku !== undefined) throw new EntradaInvalida('El SKU no se edita en Inventarios');
      if (cambios.conSerie !== undefined) throw new EntradaInvalida('conSerie solo se define al crear el producto');
      const cambiosInv: CambiosProducto = {
        ...(cambios.nombre !== undefined ? { nombre: cambios.nombre } : {}),
        ...(cambios.categoria !== undefined ? { categoria: cambios.categoria } : {}),
        ...(cambios.marca !== undefined ? { marca: cambios.marca } : {}),
        ...(cambios.activo !== undefined ? { activo: cambios.activo } : {}),
        ...(cambios.publicado !== undefined ? { publicado: cambios.publicado } : {}),
        ...(cambios.garantiaMeses !== undefined ? { garantiaMeses: cambios.garantiaMeses } : {}),
        ...(cambios.minimo !== undefined ? { minimo: cambios.minimo } : {}),
      };
      const v = await versionDe(tx, tenantId, productoId);
      await actualizarProducto(tx, { tenantId, operacionId: `consola-editar-${productoId}-v${v}`, por: autorAdm(por), productoId, cambios: cambiosInv });
    },

    async actualizarPrecioUSD(tx, tenantId, productoId, precio, por) {
      const v = await versionDe(tx, tenantId, productoId);
      await actualizarProducto(tx, {
        tenantId, operacionId: `consola-precio-${productoId}-v${v}`, por: autorAdm(por), productoId, cambios: { precioUSD: aPrecioInventarios(precio) },
      });
    },

    async existenciasPorAlmacen(tenantId, productoId) {
      return db.runTransaction(async (tx): Promise<Existencia[]> => leerExistencias(tx, tenantId, productoId));
    },
  };
}

async function versionDe(tx: TransaccionIdentidad, tenantId: string, productoId: string): Promise<number> {
  const p = await leerProducto(tx, tenantId, productoId);
  if (p === undefined) throw new EntradaInvalida(`Producto inexistente: ${productoId}`);
  return p.version;
}
