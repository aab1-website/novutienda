/** Tema claro/oscuro. Sin elección guardada el sitio sigue al dispositivo. */
import { guardarSeguro, leerSeguro, type AlmacenClaveValor } from './almacen.js';

export type Tema = 'claro' | 'oscuro';
export const CLAVE_TEMA = 'cb.tema';

export const leerTema = (a: AlmacenClaveValor | null): Tema | null => {
  const v = leerSeguro(a, CLAVE_TEMA);
  return v === 'claro' || v === 'oscuro' ? v : null;
};

export const guardarTema = (a: AlmacenClaveValor | null, t: Tema): void => guardarSeguro(a, CLAVE_TEMA, t);

export const temaEfectivo = (guardado: Tema | null, dispositivoOscuro: boolean): Tema =>
  guardado ?? (dispositivoOscuro ? 'oscuro' : 'claro');

export const alternarTema = (actual: Tema): Tema => (actual === 'oscuro' ? 'claro' : 'oscuro');
