// Utilidades compartidas de las pruebas del panel (no forma parte de la aplicación).
import { h, type JSX } from 'preact';
import { ClienteDoble } from './doble/doble.js';
import type { Rol } from './api/tipos.js';
import { AlmacenSubidasDoble } from './subidas/almacen.js';
import { ProveedorAvisos } from './ui/avisos.js';
import { CtxApp } from './ui/contexto.js';
import type { UsuarioSesion } from './sesion/sesion.js';
import { puedeVer, type ModulosActivos } from './util/menu.js';
import { PANTALLAS } from './util/pantallas.generado.js';

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
  /** Renovación del token: cuántas veces se pidió y si el servidor la acepta (por omisión, sí). */
  readonly renovacion: { llamadas: number; acepta: boolean };
  /** Módulos activos que ve `puedeVer` (por omisión, todos; `null` = aún no se sabe, solo Central). Se puede cambiar entre renders. */
  modulos: ModulosActivos;
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
  const renovacion = { llamadas: 0, acepta: true };
  const renovar = (): Promise<boolean> => {
    renovacion.llamadas += 1;
    return Promise.resolve(renovacion.acepta);
  };
  const entorno: Entorno = {
    api,
    almacen,
    usuario: () => actual,
    sesionesVencidas: () => vencidas,
    renovacion,
    modulos: PANTALLAS.map((p) => p.modulo),
    como(r) {
      actual = usuarioDe(r);
      return actual;
    },
    envolver(nodo) {
      return h(ProveedorAvisos, null, h(CtxApp.Provider, { value: { api, almacen, usuario: actual, cerrarSesion: () => undefined, sesionVencida: () => void (vencidas += 1), renovarSesion: renovar, puedeVer: (seccion: string) => puedeVer(actual.rol, seccion, entorno.modulos) } }, nodo));
    },
  };
  return entorno;
}

export const uuid = (): string => crypto.randomUUID();
