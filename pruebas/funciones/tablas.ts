// Composición de los callables como la hace `servidor/index.ts`: implementaciones de cada borde unidas a los permisos del
// registro con `tablaDeCallable`. Fuente común de las pruebas que antes leían `roles` y `propietario` de `llamadas/*.ts`.
import { tablaDeCallable } from '../../plataforma/coordinador/encendido.js';
import { accionesConsola } from '../../plataforma/funciones/servidor/llamadas/consola.js';
import { accionesInventarios } from '../../plataforma/funciones/servidor/llamadas/inventarios.js';
import type { TablaAcciones, TablaImplementaciones } from '../../plataforma/funciones/servidor/llamadas/marco.js';
import { accionesMedios } from '../../plataforma/funciones/servidor/llamadas/medios.js';
import { accionesPos } from '../../plataforma/funciones/servidor/llamadas/pos.js';
import { accionesRecibos } from '../../plataforma/funciones/servidor/llamadas/recibos.js';
import { accionesUsuarios } from '../../plataforma/funciones/servidor/llamadas/usuarios.js';

/** Implementaciones por callable; `consola` lleva además las de usuarios (Central), igual que en `index.ts`. */
export const IMPLEMENTACIONES: Readonly<Record<string, TablaImplementaciones>> = {
  pos: accionesPos,
  inventarios: accionesInventarios,
  consola: { ...accionesConsola, ...accionesUsuarios },
  recibos: accionesRecibos,
  medios: accionesMedios,
};

/** Tablas finales (con roles y `propietario` del registro) de los cinco callables. Lanza si registro y bordes no coinciden. */
export function tablasCompuestas(): Readonly<Record<string, TablaAcciones>> {
  return Object.fromEntries(Object.entries(IMPLEMENTACIONES).map(([callable, impl]) => [callable, tablaDeCallable(callable, impl)]));
}
