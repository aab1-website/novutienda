// Cableado del POS con Inventarios: `PuertoInventarios` (salida y reversión de stock dentro de la
// transacción del POS) y `PuertoCatalogo` (lectura del producto para vender).
import {
  aplicarReversion, aplicarSalida, prepararReversion, prepararSalida,
  type Autor, type PlanReversion as PlanReversionInventarios, type PlanSalida as PlanSalidaInventarios,
} from '@plataforma/inventarios';
import type { Mercado } from '@plataforma/nucleo';
import type { ProductoCatalogo, PuertoCatalogo, PuertoInventarios, QuienMueve } from '@plataforma/pos';
import { centavosADolares, leerDocumentoProducto, rutaProducto } from './producto-inventarios.js';

const ROLES: readonly string[] = ['caj', 'sup', 'adm'];

/** `QuienMueve.rol` del POS es `string`; Inventarios exige `Rol`. Se valida en el borde, no se asume. */
function autorDe(por: QuienMueve): Autor {
  if (!ROLES.includes(por.rol)) throw new Error(`Rol inválido para mover stock: ${por.rol}`);
  return { uid: por.uid, rol: por.rol as Autor['rol'] };
}

/** El plan es opaco para el POS (`unknown`): se comprueba su marca antes de entregarlo a Inventarios. */
function planDe<T extends { readonly tipo: string }>(plan: unknown, tipo: T['tipo']): T {
  if (typeof plan !== 'object' || plan === null || (plan as { tipo?: unknown }).tipo !== tipo) {
    throw new Error(`El plan recibido no es de tipo ${tipo}`);
  }
  return plan as T;
}

export const inventariosParaPos: PuertoInventarios = {
  prepararSalida: (tx, tenantId, lineas) => prepararSalida(tx, tenantId, lineas),
  aplicarSalida: (tx, plan, ref, por) => {
    aplicarSalida(tx, planDe<PlanSalidaInventarios>(plan, 'salida'), ref, autorDe(por));
  },
  prepararReversion: (tx, tenantId, ref) => prepararReversion(tx, tenantId, ref),
  aplicarReversion: (tx, plan, ref, por) => {
    aplicarReversion(tx, planDe<PlanReversionInventarios>(plan, 'reversion'), ref, autorDe(por));
  },
};

const MERCADOS: readonly [Mercado, 'bo' | 'ar'][] = [['BO', 'bo'], ['AR', 'ar']];

/** Lee el producto con la forma que pide el POS; precios en USD decimales. `null` si no existe. */
export const catalogoParaPos: PuertoCatalogo = {
  async leerProducto(tx, tenantId, productoId): Promise<ProductoCatalogo | null> {
    const d = await tx.get(rutaProducto(tenantId, productoId));
    const datos = d.data();
    if (!d.existe || datos === undefined) return null;
    const p = leerDocumentoProducto(productoId, datos);
    return {
      productoId,
      nombre: p.nombre,
      activo: p.activo,
      preciosUsd: Object.fromEntries(MERCADOS.map(([m, k]) => [m, centavosADolares(p.precioCentavos[k])])),
      controlaSeries: p.conSerie,
      ...(p.garantiaMeses !== undefined ? { garantiaMeses: p.garantiaMeses } : {}),
    };
  },
};
