/** Mercado (país) elegido por la persona. La moneda se deduce del mercado. */
import { esMercado, MONEDA_DE, type Mercado, type Moneda } from '@plataforma/nucleo';
import { guardarSeguro, leerSeguro, type AlmacenClaveValor } from './almacen.js';

export const CLAVE_MERCADO = 'cb.mercado';

export const leerMercado = (a: AlmacenClaveValor | null, permitidos: readonly Mercado[]): Mercado | null => {
  const v = leerSeguro(a, CLAVE_MERCADO);
  return esMercado(v) && permitidos.includes(v) ? v : null;
};

export const guardarMercado = (a: AlmacenClaveValor | null, m: Mercado): void => guardarSeguro(a, CLAVE_MERCADO, m);

export const monedaDe = (m: Mercado): Moneda => MONEDA_DE[m];
