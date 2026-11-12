// Utilidades compartidas de las pruebas del panel (no forma parte de la aplicación).
import { h, type JSX } from 'preact';
import { ClienteDoble } from './doble/doble.js';
import type { Rol } from './api/tipos.js';
import { AlmacenSubidasDoble } from './subidas/almacen.js';
import { ProveedorAvisos } from './ui/avisos.js';
import { CtxApp } from './ui/contexto.js';
import type { UsuarioSesion } from './sesion/sesion.js';

export const AHORA = Date.UTC(2026, 10, 4, 15, 0, 0);

export type Nodo = JSX.Element;

export interface Entorno {
  readonly api: ClienteDoble;
  readonly almacen: AlmacenSubidasDoble;
  readonly usuario: () => UsuarioSesion;
  /** Cambia quién llama (el doble aplica los permisos de ese rol). */
  como(rol: Rol): UsuarioSesion;
  /** Cuántas veces una pantalla avisó que la sesión venció. */
  sesionesVencidas(): number;
  /** Envuelve un nodo con el contexto de la aplicación. */
  envolver(nodo: Nodo): Nodo;
}

export function usuarioDe(rol: Rol): UsuarioSesion {
  return { uid: `u-${rol}`, correo: `${rol}@ejemplo.test`, tenantId: 'demo', rol };
}

export function crearEntorno(rol: Rol = 'caj', ahora: () => number = () => AHORA): Entorno {
  let actual = usuarioDe(rol);
  let vencidas = 0;
  const api = new ClienteDoble({ usuario: () => ({ uid: actual.uid, rol: actual.rol }), ahora });
  const almacen = new AlmacenSubidasDoble();
  const entorno: Entorno = {
    api,
    almacen,
    usuario: () => actual,
    sesionesVencidas: () => vencidas,
    como(r) {
      actual = usuarioDe(r);
      return actual;
    },
    envolver(nodo) {
      return h(ProveedorAvisos, null, h(CtxApp.Provider, { value: { api, almacen, usuario: actual, cerrarSesion: () => undefined, sesionVencida: () => void (vencidas += 1) } }, nodo));
    },
  };
  return entorno;
}

export const uuid = (): string => crypto.randomUUID();
