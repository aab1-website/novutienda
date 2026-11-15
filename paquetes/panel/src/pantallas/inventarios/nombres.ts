import { UBICACIONES, type CodigoMoneda, type IdMercado, type MercadoDeclarado, type TipoMovimiento, type UbicacionId } from '../../api/tipos.js';

/** Nombres legibles que ve la persona, en lugar de los códigos internos. */

export const NOMBRE_ALMACEN: Readonly<Record<UbicacionId, string>> = { tienda: 'Tienda', 'deposito-1': 'Depósito 1', 'deposito-2': 'Depósito 2' };

export const NOMBRE_TIPO: Readonly<Record<TipoMovimiento, string>> = {
  ingreso: 'Ingreso', traspaso: 'Traspaso', ajuste: 'Ajuste', venta: 'Venta', anulacion: 'Anulación', merma: 'Merma', conteo: 'Conteo', pedido: 'Pedido',
};

export const nombreAlmacen = (id: string): string => (UBICACIONES as readonly string[]).includes(id) ? NOMBRE_ALMACEN[id as UbicacionId] : id;
export const nombreTipo = (tipo: string): string => NOMBRE_TIPO[tipo as TipoMovimiento] ?? tipo;

export const OPCIONES_ALMACEN: readonly { valor: string; texto: string }[] = UBICACIONES.map((u) => ({ valor: u, texto: NOMBRE_ALMACEN[u] }));

/**
 * Clave con la que se guarda el precio de un mercado en `precioUSD` del producto (el id en minúsculas: `BO` → `bo`).
 * Único punto del panel que la deriva. Es la misma regla de `claveDePrecio`; se sustituye por la importación de
 * `@novutienda/nucleo` en cuanto esa función llegue a la base de esta rama (hoy solo está en #111).
 */
export const clavePrecioDe = (idMercado: IdMercado): string => idMercado.toLowerCase();

/** Un mercado declarado por el comercio, con la clave en que se guarda su precio y el nombre que ve la persona. */
export interface MercadoPrecio {
  readonly id: IdMercado;
  readonly clave: string;
  readonly nombre: string;
  readonly monedaVenta: CodigoMoneda;
  readonly monedaBase: CodigoMoneda;
}

/** Los mercados declarados, en el orden declarado; el nombre es el declarado por el comercio. */
export const mercadosDePrecio = (ms: readonly MercadoDeclarado[]): readonly MercadoPrecio[] =>
  ms.map((m) => ({ id: m.id, clave: clavePrecioDe(m.id), nombre: m.nombre, monedaVenta: m.monedaVenta, monedaBase: m.monedaBase }));

const MONEDA_PLURAL: Readonly<Record<string, string>> = { USD: 'dólares', BOB: 'bolivianos', ARS: 'pesos argentinos' };

/** «dólares», «bolivianos»…; una moneda no listada se nombra con su código. */
export const nombreMoneda = (moneda: CodigoMoneda): string => (Object.hasOwn(MONEDA_PLURAL, moneda) ? (MONEDA_PLURAL[moneda] as string) : moneda);
