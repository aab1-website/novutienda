import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { ClienteApi } from '../api/cliente.js';
import type { AlmacenSubidas } from '../subidas/almacen.js';
import type { UsuarioSesion } from '../sesion/sesion.js';

export interface ContextoApp {
  readonly api: ClienteApi;
  readonly almacen: AlmacenSubidas;
  readonly usuario: UsuarioSesion;
  readonly cerrarSesion: () => void;
  /** La sesión venció (el servidor respondió «unauthenticated»): cierra la sesión y lleva al ingreso conservando la ruta. */
  readonly sesionVencida: () => void;
}

export const CtxApp = createContext<ContextoApp | null>(null);

export function useApp(): ContextoApp {
  const c = useContext(CtxApp);
  if (c === null) throw new Error('Falta el contexto de la aplicación');
  return c;
}
