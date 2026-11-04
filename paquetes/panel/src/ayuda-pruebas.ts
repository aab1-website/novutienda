// Utilidades compartidas de las pruebas del panel (no forma parte de la aplicación).
import { h, type VNode } from 'preact';
import { ClienteDoble } from './doble/doble.js';
import type { Rol } from './api/tipos.js';
import { AlmacenSubidasDoble } from './subidas/almacen.js';
import { CtxApp } from './ui/contexto.js';
import type { UsuarioSesion } from './sesion/sesion.js';

export const AHORA = Date.UTC(2026, 10, 4, 15, 0, 0);

export interface Entorno {
  readonly api: ClienteDoble;
  readonly almacen: AlmacenSubidasDoble;
  readonly usuario: () => UsuarioSesion;
  /** Cambia quién llama (el doble aplica los permisos de ese rol). */
  como(rol: Rol): UsuarioSesion;
  /** Envuelve un nodo con el contexto de la aplicación. */
  envolver(nodo: VNode): VNode;
}

export function usuarioDe(rol: Rol): UsuarioSesion {
  return { uid: `u-${rol}`, correo: `${rol}@ejemplo.test`, tenantId: 'demo', rol };
}

export function crearEntorno(rol: Rol = 'caj', ahora: () => number = () => AHORA): Entorno {
  let actual = usuarioDe(rol);
  const api = new ClienteDoble({ usuario: () => ({ uid: actual.uid, rol: actual.rol }), ahora });
  const almacen = new AlmacenSubidasDoble();
  const entorno: Entorno = {
    api,
    almacen,
    usuario: () => actual,
    como(r) {
      actual = usuarioDe(r);
      return actual;
    },
    envolver(nodo) {
      return h(CtxApp.Provider, { value: { api, almacen, usuario: actual, cerrarSesion: () => undefined } }, nodo);
    },
  };
  return entorno;
}

export const uuid = (): string => crypto.randomUUID();
