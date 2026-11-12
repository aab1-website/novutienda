import { MERCADOS, MONEDA_DE, type Mercado } from '@novutienda/nucleo';
import { UBICACIONES, type TipoMovimiento, type UbicacionId } from '../../api/tipos.js';

/** Nombres legibles que ve la persona, en lugar de los códigos internos. */

export const NOMBRE_ALMACEN: Readonly<Record<UbicacionId, string>> = { tienda: 'Tienda', 'deposito-1': 'Depósito 1', 'deposito-2': 'Depósito 2' };

export const NOMBRE_TIPO: Readonly<Record<TipoMovimiento, string>> = {
  ingreso: 'Ingreso', traspaso: 'Traspaso', ajuste: 'Ajuste', venta: 'Venta', anulacion: 'Anulación', merma: 'Merma', conteo: 'Conteo', pedido: 'Pedido',
};

/** Nombre del mercado. Tipado con `Record<Mercado, …>`: si el núcleo suma un mercado, esto deja de compilar hasta nombrarlo. */
export const NOMBRE_MERCADO: Readonly<Record<Mercado, string>> = { BO: 'Bolivia', AR: 'Argentina' };

export const nombreAlmacen = (id: string): string => (UBICACIONES as readonly string[]).includes(id) ? NOMBRE_ALMACEN[id as UbicacionId] : id;
export const nombreTipo = (tipo: string): string => NOMBRE_TIPO[tipo as TipoMovimiento] ?? tipo;

export const OPCIONES_ALMACEN: readonly { valor: string; texto: string }[] = UBICACIONES.map((u) => ({ valor: u, texto: NOMBRE_ALMACEN[u] }));

/** Los mercados del núcleo con su clave de precio (`BO` → `bo`), su moneda y su nombre. */
export const MERCADOS_PRECIO: readonly { mercado: Mercado; clave: 'bo' | 'ar'; moneda: (typeof MONEDA_DE)[Mercado]; nombre: string }[] = MERCADOS.map((m) => ({
  mercado: m,
  clave: m.toLowerCase() as 'bo' | 'ar',
  moneda: MONEDA_DE[m],
  nombre: NOMBRE_MERCADO[m],
}));
