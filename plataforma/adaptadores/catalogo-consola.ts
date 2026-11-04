// `CatalogoPuerto` de la consola implementado con las funciones de Inventarios (dueño de productos y
// stock). La consola nunca escribe esas colecciones; todo pasa por `crearProducto` y
// `actualizarProducto`, cada uno en UNA transacción.
import { EntradaInvalida, UBICACIONES, actualizarProducto, crearProducto, type Autor, type CambiosProducto } from '@plataforma/inventarios';
import type { BaseDatosIdentidad } from '@plataforma/nucleo';
import type { CatalogoPuerto, DatosProducto, Existencia, PrecioUSD, ProductoCatalogo } from '@plataforma/consola';
import type { LectorColecciones } from './colecciones.js';
import {
  centavosADolares, dolaresACentavos, leerDocumentoProducto, rutaExistencia, rutaProducto, type ProductoInventarios,
} from './producto-inventarios.js';

export interface DepsCatalogoConsola {
  readonly db: BaseDatosIdentidad;
  readonly lector: LectorColecciones;
}

/** El puerto de la consola solo trae el uid de quien opera; la consola ya exigió rol `adm`. */
const autorAdm = (uid: string): Autor => ({ uid, rol: 'adm' });

const aPrecioConsola = (c: ProductoInventarios['precioCentavos']): PrecioUSD => ({ bo: centavosADolares(c.bo), ar: centavosADolares(c.ar) });
const aPrecioInventarios = (p: PrecioUSD): { bo: number; ar: number } => ({ bo: dolaresACentavos(p.bo), ar: dolaresACentavos(p.ar) });

function aProductoConsola(p: ProductoInventarios): ProductoCatalogo {
  return {
    id: p.productoId,
    nombre: p.nombre,
    categoria: p.categoria ?? '',
    ...(p.sku !== undefined ? { sku: p.sku } : {}),
    activo: p.activo,
    ...(p.garantiaMeses !== undefined ? { garantiaMeses: p.garantiaMeses } : {}),
    precioUSD: aPrecioConsola(p.precioCentavos),
    ...(p.stockTotal !== undefined ? { stockTotal: p.stockTotal } : {}),
  };
}

/** Campos que la consola acepta pero Inventarios no guarda: se rechazan, nunca se descartan en silencio. */
function exigirSoportados(datos: Partial<DatosProducto>): void {
  if (datos.marca !== undefined) throw new EntradaInvalida('Inventarios no guarda la marca del producto');
}

export function crearCatalogoConsola(deps: DepsCatalogoConsola): CatalogoPuerto {
  const { db, lector } = deps;

  const leer = (tenantId: string, productoId: string): Promise<ProductoInventarios | undefined> =>
    db.runTransaction(async (tx) => {
      const d = await tx.get(rutaProducto(tenantId, productoId));
      const datos = d.data();
      return d.existe && datos !== undefined ? leerDocumentoProducto(productoId, datos) : undefined;
    });

  return {
    async listarProductos(tenantId) {
      const docs = await lector.listar(`tenants/${tenantId}/productos`);
      return docs.map((d) => aProductoConsola(leerDocumentoProducto(d.id, d.datos)));
    },

    async leerProducto(tenantId, productoId) {
      const p = await leer(tenantId, productoId);
      return p === undefined ? undefined : aProductoConsola(p);
    },

    /**
     * Alta con el tope de 200 productos: `crearProducto` de Inventarios reserva el cupo del contador
     * `contadores/uso` (el mismo que `verificarYReservar` del núcleo) en la misma transacción. Id de
     * operación determinista: reintentar el alta con el mismo contenido no duplica ni gasta otro cupo.
     * Sin SKU, el SKU es el id del producto (Inventarios exige uno único).
     */
    async crearProducto(tenantId, productoId, datos, precioUSD, por) {
      exigirSoportados(datos);
      await db.runTransaction((tx) =>
        crearProducto(tx, {
          tenantId,
          operacionId: `consola-crear-${productoId}`,
          por: autorAdm(por),
          producto: {
            id: productoId,
            nombre: datos.nombre,
            categoria: datos.categoria,
            sku: datos.sku ?? productoId,
            activo: datos.activo,
            ...(datos.garantiaMeses !== undefined ? { garantiaMeses: datos.garantiaMeses } : {}),
            precioUSD: aPrecioInventarios(precioUSD),
          },
        }),
      );
    },

    /** La operación lleva la versión leída: repetir la misma edición es idempotente; otra edición sobre la misma versión es conflicto. */
    async actualizarDatosProducto(tenantId, productoId, cambios, por) {
      exigirSoportados(cambios);
      if (cambios.sku !== undefined) throw new EntradaInvalida('El SKU no se edita en Inventarios');
      const cambiosInv: CambiosProducto = {
        ...(cambios.nombre !== undefined ? { nombre: cambios.nombre } : {}),
        ...(cambios.categoria !== undefined ? { categoria: cambios.categoria } : {}),
        ...(cambios.activo !== undefined ? { activo: cambios.activo } : {}),
        ...(cambios.garantiaMeses !== undefined ? { garantiaMeses: cambios.garantiaMeses } : {}),
      };
      await db.runTransaction(async (tx) => {
        const v = await versionDe(tx, tenantId, productoId);
        await actualizarProducto(tx, {
          tenantId, operacionId: `consola-editar-${productoId}-v${v}`, por: autorAdm(por), productoId, cambios: cambiosInv,
        });
      });
    },

    async actualizarPrecioUSD(tenantId, productoId, precio, por) {
      await db.runTransaction(async (tx) => {
        const v = await versionDe(tx, tenantId, productoId);
        await actualizarProducto(tx, {
          tenantId, operacionId: `consola-precio-${productoId}-v${v}`, por: autorAdm(por), productoId,
          cambios: { precioUSD: aPrecioInventarios(precio) },
        });
      });
    },

    async existenciasPorAlmacen(tenantId, productoId) {
      return db.runTransaction(async (tx) => {
        const salida: Existencia[] = [];
        for (const u of UBICACIONES) {
          const d = await tx.get(rutaExistencia(tenantId, productoId, u));
          const cantidad = d.data()?.['cantidad'];
          if (d.existe && typeof cantidad === 'number') salida.push({ ubicacionId: u, cantidad });
        }
        return salida;
      });
    },
  };
}

async function versionDe(
  tx: { get(ruta: string): Promise<{ existe: boolean; data(): Readonly<Record<string, unknown>> | undefined }> },
  tenantId: string,
  productoId: string,
): Promise<number> {
  const d = await tx.get(rutaProducto(tenantId, productoId));
  const datos = d.data();
  if (!d.existe || datos === undefined) throw new EntradaInvalida(`Producto inexistente: ${productoId}`);
  return leerDocumentoProducto(productoId, datos).version;
}
